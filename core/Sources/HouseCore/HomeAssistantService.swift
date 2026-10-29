import Foundation

/// A Home Assistant server on the local network (or anywhere it is reachable), through its
/// REST API with a long-lived access token. Lights and switches become lamps, `climate`
/// entities become air conditioners and temperature sensors can stand in for an AC's room
/// reading. A WebSocket subscription tells the hub the moment something changes.
@MainActor
public final class HomeAssistantService: DeviceService {
    public let id = "homeassistant"
    public let title = "Home Assistant"
    public var onChange: (() -> Void)?

    struct Config: Codable {
        var url: String
        var token: String
        var name: String?
        var version: String?
        /// The address from outside the home network (Nabu Casa, a tunnel, a reverse proxy),
        /// used while `url` does not answer.
        var external: String?
    }

    private let vault: SecretStore
    private var config: Config?
    /// The address that answered last: `config.url`, or `config.external` while away from home.
    private var active: String?
    /// When the local address was last tried while on the external one.
    private var lastLocalTry = Date.distantPast
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var socketRetry: Task<Void, Never>?
    /// Each climate entity's own names for the panel's fan speeds and modes, from the last read.
    private var fanNames: [String: [String: String]] = [:]
    private var modeNames: [String: [String: String]] = [:]
    private var swingNames: [String: [String]] = [:]
    /// Each media player's `supported_features`, from the last read.
    private var mediaSupport: [String: Int] = [:]
    /// The entities linked in the plan: only their changes are worth a read.
    private var watched: Set<String> = []
    private var changePending = false

    public init(vault: SecretStore) {
        self.vault = vault
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        session = URLSession(configuration: configuration)
        config = vault.read().flatMap { try? JSONDecoder().decode(Config.self, from: $0) }
        if config != nil { listen() }
    }

    public var isConnected: Bool { config != nil }

    public var info: [String: Any] {
        guard let config else { return ["connected": false] }
        return ["connected": true, "url": config.url, "external": config.external ?? "",
                "active": active ?? config.url, "away": active != nil && active != config.url,
                "name": config.name ?? "Home Assistant", "version": config.version ?? ""]
    }

    /// For the iPhone: the Mac shares its connection over the paired, encrypted sync.
    public var shareable: [String: Any]? {
        guard let config else { return nil }
        return ["url": config.url, "token": config.token, "name": config.name ?? "", "version": config.version ?? "",
                "external": config.external ?? ""]
    }

    // MARK: - Connecting

    /// Checks the address and the token, then keeps them. `external` is optional: the address
    /// to fall back on away from home. One of the two has to answer.
    public func connect(url raw: String, token: String, external rawExternal: String? = nil) async throws {
        let url = try Self.normalize(raw)
        let external = try rawExternal.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : try Self.normalize($0) }
        let token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { throw ServiceFailure("Cole um token de acesso de longa duração (seu perfil no Home Assistant → Segurança).") }
        var candidate = Config(url: url, token: token, external: external)
        let about = try await request("GET", "/api/config", config: candidate) as? [String: Any] ?? [:]
        candidate.name = about["location_name"] as? String
        candidate.version = about["version"] as? String
        config = candidate
        vault.write(try? JSONEncoder().encode(candidate))
        listen()
    }

    /// Takes a connection shared by the Mac; nil removes it.
    public func adopt(_ shared: [String: Any]?) {
        guard let shared, let url = shared["url"] as? String, let token = shared["token"] as? String else {
            if config != nil { disconnect() }
            return
        }
        let name = (shared["name"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let external = (shared["external"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        guard config?.url != url || config?.token != token || config?.name != name || config?.external != external else { return }
        config = Config(url: url, token: token, name: name, version: shared["version"] as? String, external: external)
        active = nil
        vault.write(try? JSONEncoder().encode(config))
        listen()
    }

    public func watch(_ ids: Set<String>) { watched = ids }

    public func disconnect() {
        config = nil
        active = nil
        vault.write(nil)
        socketRetry?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
    }

    /// "homeassistant.local:8123" → "http://homeassistant.local:8123".
    static func normalize(_ raw: String) throws -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { throw ServiceFailure("Digite o endereço do seu Home Assistant, por exemplo http://homeassistant.local:8123") }
        if !s.contains("://") { s = "http://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        guard let url = URL(string: s), url.host != nil, ["http", "https"].contains(url.scheme ?? "") else {
            throw ServiceFailure("“\(raw)” não é um endereço web")
        }
        if url.port == nil, url.scheme == "http", (url.host ?? "").hasSuffix(".local") || url.host == "homeassistant" {
            s += ":8123" // Home Assistant's default port, which people leave out
        }
        return s
    }

    // MARK: - Devices

    public func devices() async throws -> [ServiceDevice] {
        let states = try await request("GET", "/api/states") as? [[String: Any]] ?? []
        let areas = (try? await areaNames(for: states.compactMap { $0["entity_id"] as? String })) ?? [:]
        return states.compactMap { state in
            guard var device = Self.device(from: state) else { return nil }
            device.room = areas[device.id]
            return device
        }.sorted { ($0.kind.rawValue, $0.name) < ($1.kind.rawValue, $1.name) }
    }

    /// Area of every entity, in one template request (the REST API has no area endpoint).
    private func areaNames(for ids: [String]) async throws -> [String: String] {
        let template = "{% for e in states %}{{ e.entity_id }}\t{{ area_name(e.entity_id) or '' }}\n{% endfor %}"
        guard let text = try await request("POST", "/api/template", body: ["template": template], raw: true) as? String else { return [:] }
        var out: [String: String] = [:]
        for line in text.split(separator: "\n") {
            let parts = line.split(separator: "\t", maxSplits: 1).map(String.init)
            if parts.count == 2, !parts[1].isEmpty, parts[1] != "None" { out[parts[0]] = parts[1] }
        }
        return out
    }

    public func read(_ ids: Set<String>) async throws -> [String: DeviceReading] {
        guard !ids.isEmpty else { return [:] }
        let states = try await request("GET", "/api/states") as? [[String: Any]] ?? []
        var out: [String: DeviceReading] = [:]
        for state in states {
            guard let id = state["entity_id"] as? String, ids.contains(id) else { continue }
            let attributes = state["attributes"] as? [String: Any] ?? [:]
            if id.hasPrefix("climate.") {
                fanNames[id] = FanNames.table(attributes["fan_modes"] as? [String] ?? [])
                modeNames[id] = Self.modeTable(attributes["hvac_modes"] as? [String] ?? [])
                swingNames[id] = attributes["swing_modes"] as? [String] ?? []
            }
            if id.hasPrefix("media_player."), let f = attributes["supported_features"] as? Int { mediaSupport[id] = f }
            out[id] = Self.reading(from: state)
        }
        return out
    }

    public func send(kind: DeviceKind, id: String, patch: [String: Any], state: [String: Any]) async throws {
        for call in Self.calls(for: id, patch: patch, state: state,
                               fans: fanNames[id] ?? [:], modes: modeNames[id] ?? [:], swings: swingNames[id] ?? [],
                               media: mediaSupport[id]) {
            _ = try await request("POST", "/api/services/\(call.domain)/\(call.service)", body: call.data)
        }
    }

    // MARK: - Mapping (static, so the tests can run it without a server)

    static func device(from state: [String: Any]) -> ServiceDevice? {
        guard let id = state["entity_id"] as? String else { return nil }
        let attributes = state["attributes"] as? [String: Any] ?? [:]
        let name = attributes["friendly_name"] as? String ?? id
        let domain = id.split(separator: ".").first.map(String.init) ?? ""
        var device: ServiceDevice
        switch domain {
        case "light":
            device = ServiceDevice(id: id, name: name, kind: .light)
            let modes = attributes["supported_color_modes"] as? [String] ?? []
            device.capabilities = lightCapabilities(modes)
            device.detail = "light · " + (modes.isEmpty ? "on/off" : modes.joined(separator: ", "))
        case "switch":
            device = ServiceDevice(id: id, name: name, kind: .light)
            device.detail = "switch · on/off"
        case "climate":
            device = ServiceDevice(id: id, name: name, kind: .ac)
            if let lo = attributes.double("min_temp"), let hi = attributes.double("max_temp") {
                device.range = (max(lo, 10), min(hi, 32))
            }
            device.detail = "climate · " + (attributes["hvac_modes"] as? [String] ?? []).joined(separator: ", ")
        case "sensor":
            guard isTemperature(attributes) else { return nil }
            device = ServiceDevice(id: id, name: name, kind: .sensor)
            device.detail = "sensor de temperatura"
        case "cover":
            device = ServiceDevice(id: id, name: name, kind: .gate)
            device.detail = "cover · " + (attributes["device_class"] as? String ?? "portão")
        case "script", "scene":
            device = ServiceDevice(id: id, name: name, kind: .shortcut)
            device.detail = domain
        case "media_player":
            device = ServiceDevice(id: id, name: name, kind: .tv)
            device.detail = "media_player · " + (attributes["device_class"] as? String ?? "mídia")
        case "input_boolean", "automation":
            device = ServiceDevice(id: id, name: name, kind: .toggle)
            device.detail = domain == "automation" ? "automação" : "input_boolean"
        default:
            return nil
        }
        device.online = !["unavailable", "unknown"].contains(state["state"] as? String ?? "")
        return device
    }

    static func lightCapabilities(_ modes: [String]) -> [String] {
        var caps: [String] = []
        if modes.contains(where: { $0 != "onoff" }) { caps.append("brightness") }
        if modes.contains("color_temp") { caps.append("temp") }
        if modes.contains(where: { ["hs", "xy", "rgb", "rgbw", "rgbww"].contains($0) }) { caps.append("color") }
        return caps
    }

    static func isTemperature(_ attributes: [String: Any]) -> Bool {
        (attributes["device_class"] as? String) == "temperature"
            || ["°C", "°F"].contains(attributes["unit_of_measurement"] as? String ?? "")
    }

    /// The panel's AC modes and the climate entity's names for them.
    static func modeTable(_ hvacModes: [String]) -> [String: String] {
        var out: [String: String] = [:]
        for (panel, names) in [("cool", ["cool"]), ("heat", ["heat"]), ("dry", ["dry"]),
                               ("fan", ["fan_only"]), ("auto", ["auto", "heat_cool"])] {
            if let name = names.first(where: hvacModes.contains) { out[panel] = name }
        }
        return out
    }

    static func reading(from state: [String: Any]) -> DeviceReading {
        let id = state["entity_id"] as? String ?? ""
        let value = state["state"] as? String ?? ""
        let attributes = state["attributes"] as? [String: Any] ?? [:]
        var reading = DeviceReading(online: !["unavailable", "unknown"].contains(value))
        guard reading.online else { return reading }

        if id.hasPrefix("light.") || id.hasPrefix("switch.") {
            var light: [String: Any] = ["on": value == "on"]
            if value == "on", let b = attributes.double("brightness") { light["brightness"] = max(0.05, min(1, b / 255)) }
            switch attributes["color_mode"] as? String {
            case "color_temp":
                if let k = attributes.double("color_temp_kelvin") { light["temp"] = max(2200, min(6500, k)); light["color"] = NSNull() }
            case "hs", "xy", "rgb", "rgbw", "rgbww":
                if let rgb = attributes["rgb_color"] as? [Any], rgb.count == 3 {
                    let c = rgb.compactMap { ($0 as? NSNumber)?.doubleValue }
                    if c.count == 3 { light["color"] = ColorMath.hex(r: c[0] / 255, g: c[1] / 255, b: c[2] / 255) }
                }
            default: break
            }
            reading.light = light
        } else if id.hasPrefix("climate.") {
            let modes = modeTable(attributes["hvac_modes"] as? [String] ?? [])
            var ac: [String: Any] = ["on": value != "off"]
            // On, but not running right now: a thermostat whose room is already warm (or cool) enough.
            let action = attributes["hvac_action"] as? String
            ac["idle"] = value != "off" && (action == "idle" || action == "off")
            if let mode = modes.first(where: { $0.value == value })?.key { ac["mode"] = mode }
            if let t = attributes.double("temperature") {
                ac["target"] = t
            } else if let lo = attributes.double("target_temp_low"), let hi = attributes.double("target_temp_high") {
                ac["target"] = ((lo + hi) / 2).rounded()
            }
            if let room = attributes.double("current_temperature") { ac["roomTemp"] = room }
            let fans = FanNames.table(attributes["fan_modes"] as? [String] ?? [])
            if let current = attributes["fan_mode"] as? String, let fan = FanNames.panel(current), fans[fan] != nil { ac["fan"] = fan }
            let swings = attributes["swing_modes"] as? [String] ?? []
            if let swing = attributes["swing_mode"] as? String, !swings.isEmpty { ac["swing"] = panelSwing(swing) }
            let presets = attributes["preset_modes"] as? [String] ?? []
            let preset = attributes["preset_mode"] as? String ?? ""
            if presets.contains("sleep") { ac["sleep"] = preset == "sleep" }
            if presets.contains("eco") { ac["eco"] = preset == "eco" }
            reading.ac = ac
            reading.features = [
                "modes": ["cool", "heat", "dry", "fan", "auto"].filter { modes[$0] != nil },
                "fans": FanNames.order.filter { fans[$0] != nil },
                "swing": swings.contains("off") && swings.count > 1,
                // The directions it offers besides "swing" (all ways) and "off": Midea's horizontal / vertical.
                "swings": ["swing", "horizontal", "vertical", "off"].filter { panel in
                    panel == "swing" ? swings.contains { !["off", "horizontal", "vertical"].contains($0) } : swings.contains(panel)
                },
                "sleep": presets.contains("sleep"), "eco": presets.contains("eco"),
            ]
        } else if id.hasPrefix("cover.") {
            reading.gate = ["open", "closed", "opening", "closing"].contains(value) ? value : "closed"
            if let p = attributes.double("current_position") { reading.gatePosition = max(0, min(1, p / 100)) }
        } else if id.hasPrefix("media_player.") {
            reading.media = mediaState(value, attributes)
        } else if id.hasPrefix("input_boolean.") || id.hasPrefix("automation.") {
            reading.toggle = value == "on"
        } else if id.hasPrefix("sensor."), let t = Double(value) {
            reading.temperature = (attributes["unit_of_measurement"] as? String) == "°F" ? (t - 32) * 5 / 9 : t
        }
        return reading
    }

    struct Call {
        var domain: String
        var service: String
        var data: [String: Any]
    }

    /// A media player in the panel's terms. "standby" and "off" are off; LG webOS reports
    /// "on" while showing an app and "playing" / "paused" with a player.
    static func mediaState(_ value: String, _ attributes: [String: Any]) -> [String: Any] {
        var media: [String: Any] = ["on": !["off", "standby"].contains(value), "state": value]
        if let v = attributes.double("volume_level") { media["volume"] = max(0, min(1, v)) }
        if let m = attributes["is_volume_muted"] as? Bool { media["muted"] = m }
        media["source"] = attributes["source"] as? String ?? NSNull()
        media["sources"] = attributes["source_list"] as? [String] ?? []
        let title = [attributes["media_title"] as? String, attributes["app_name"] as? String]
            .compactMap { $0 }.first { !$0.isEmpty }
        media["title"] = title ?? NSNull()
        media["controls"] = mediaControls(attributes["supported_features"] as? Int)
        return media
    }

    /// Home Assistant's media player feature bits, by the panel's control names.
    static let mediaFeatures: [(name: String, bits: Int)] = [
        ("power", 128 | 256), ("volume", 4), ("mute", 8), ("step", 1024), ("source", 2048),
        ("play", 1 | 16384), ("next", 32), ("previous", 16),
    ]

    /// What a player can do; everything when it does not say.
    static func mediaControls(_ supported: Int?) -> [String] {
        mediaFeatures.filter { supported == nil || supported! & $0.bits != 0 }.map(\.name)
    }

    /// The panel's airflow for a climate entity's `swing_mode`: "off", "horizontal", "vertical",
    /// or "swing" for anything that moves both ways ("on", "both").
    static func panelSwing(_ name: String) -> String {
        ["off", "horizontal", "vertical"].contains(name) ? name : "swing"
    }

    static func calls(for id: String, patch: [String: Any], state: [String: Any],
                      fans: [String: String], modes: [String: String], swings: [String] = [],
                      media: Int? = nil) -> [Call] {
        let domain = id.split(separator: ".").first.map(String.init) ?? ""
        let target: [String: Any] = ["entity_id": id]
        func call(_ service: String, _ data: [String: Any] = [:], domain d: String = domain) -> Call {
            Call(domain: d, service: service, data: target.merging(data) { $1 })
        }

        if ["switch", "input_boolean", "automation"].contains(domain) {
            guard let on = patch["on"] as? Bool else { return [] }
            return [call(on ? "turn_on" : "turn_off")]
        }
        if domain == "cover" {
            switch patch["action"] as? String {
            case "open": return [call("open_cover")]
            case "close": return [call("close_cover")]
            case "stop": return [call("stop_cover")]
            default: return []
            }
        }
        if domain == "media_player" {
            var out: [Call] = []
            if let on = patch["on"] as? Bool { out.append(call(on ? "turn_on" : "turn_off")) }
            if let v = patch["volume"] as? Double { out.append(call("volume_set", ["volume_level": (max(0, min(1, v)) * 100).rounded() / 100])) }
            if let m = patch["muted"] as? Bool { out.append(call("volume_mute", ["is_volume_muted": m])) }
            if let s = patch["source"] as? String { out.append(call("select_source", ["source": s])) }
            let actions = ["play_pause": "media_play_pause", "next": "media_next_track", "previous": "media_previous_track",
                           "volume_up": "volume_up", "volume_down": "volume_down"]
            if let a = patch["action"] as? String, let service = actions[a] { out.append(call(service)) }
            // Only what this player accepts: Home Assistant refuses the whole request otherwise.
            let can = Set(mediaControls(media))
            let needs = ["volume_set": "volume", "volume_mute": "mute", "select_source": "source",
                         "volume_up": "step", "volume_down": "step", "media_play_pause": "play",
                         "media_next_track": "next", "media_previous_track": "previous"]
            return out.filter { needs[$0.service].map(can.contains) ?? true }
        }
        if domain == "script" || domain == "scene" {
            return patch["run"] as? Bool == true ? [call("turn_on")] : []
        }
        if domain == "light" {
            if patch["on"] as? Bool == false { return [call("turn_off")] }
            var data: [String: Any] = [:]
            if let b = patch["brightness"] as? Double { data["brightness_pct"] = Int((b * 100).rounded()) }
            if let k = patch["temp"] as? Double { data["color_temp_kelvin"] = Int(k) }
            if let hex = patch["color"] as? String, let (r, g, b) = ColorMath.rgb(hex) {
                data["rgb_color"] = [Int(r * 255), Int(g * 255), Int(b * 255)]
            }
            guard !data.isEmpty || patch["on"] as? Bool == true else { return [] }
            return [call("turn_on", data)]
        }
        guard domain == "climate" else { return [] }

        var out: [Call] = []
        let on = patch["on"] as? Bool
        if on == false { return [call("set_hvac_mode", ["hvac_mode": "off"])] }
        // Picking a mode is what switches a climate entity on.
        if on == true || patch["mode"] != nil {
            let mode = (patch["mode"] as? String) ?? (state["mode"] as? String) ?? "cool"
            if let name = modes[mode] ?? modes.values.first { out.append(call("set_hvac_mode", ["hvac_mode": name])) }
        }
        if let t = patch["target"] as? Double {
            out.append(call("set_temperature", ["temperature": t]))
        }
        if let fan = patch["fan"] as? String, let name = fans[fan] {
            out.append(call("set_fan_mode", ["fan_mode": name]))
        }
        if let swing = patch["swing"] as? String {
            // "swing" is whatever moves both ways on this unit: "on" for most, "both" for Midea.
            let name = swing != "swing" ? swing
                : swings.first { $0 == "on" } ?? swings.first { $0 == "both" } ?? swings.first { $0 != "off" } ?? "on"
            out.append(call("set_swing_mode", ["swing_mode": name]))
        }
        for preset in ["sleep", "eco"] {
            if let enabled = patch[preset] as? Bool {
                out.append(call("set_preset_mode", ["preset_mode": enabled ? preset : "none"]))
            }
        }
        return out
    }

    // MARK: - HTTP

    /// The addresses to try, in order: the one that answered last first. While on the external
    /// address the local one is tried again once a minute, so coming home switches back.
    static func addresses(_ config: Config, active: String?, localDue: Bool) -> [String] {
        guard let external = config.external, external != config.url else { return [config.url] }
        return active == external && !localDue ? [external, config.url] : [config.url, external]
    }

    @discardableResult
    private func request(_ method: String, _ path: String, body: [String: Any]? = nil,
                         raw: Bool = false, config: Config? = nil) async throws -> Any? {
        guard let config = config ?? self.config else {
            throw ServiceFailure("Conecte o Home Assistant primeiro")
        }
        let localDue = active == config.external && Date().timeIntervalSince(lastLocalTry) > 60
        if localDue { lastLocalTry = Date() }
        let bases = Self.addresses(config, active: active, localDue: localDue)
        var unreachable: [String] = []
        for (index, base) in bases.enumerated() {
            guard let url = URL(string: base + path) else { continue }
            var request = URLRequest(url: url)
            request.httpMethod = method
            // A home network answers in milliseconds: no need to wait long before going outside.
            if index == 0, bases.count > 1 { request.timeoutInterval = 2.5 }
            request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
            if let body {
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: body)
            }
            let data: Data, response: URLResponse
            do {
                (data, response) = try await session.data(for: request)
            } catch {
                unreachable.append("\(base): \(error.localizedDescription)")
                continue
            }
            use(base)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            switch status {
            case 200..<300: break
            case 401, 403: throw ServiceFailure("O Home Assistant recusou o token. Crie um novo token de acesso de longa duração e conecte de novo.")
            case 404: throw ServiceFailure("O Home Assistant não conhece \(path). A API está ativada?")
            default:
                let text = String(data: data, encoding: .utf8)?.prefix(200) ?? ""
                throw ServiceFailure("O Home Assistant respondeu \(status) \(text)")
            }
            if raw { return String(data: data, encoding: .utf8) }
            return data.isEmpty ? nil : try? JSONSerialization.jsonObject(with: data)
        }
        throw ServiceFailure("O Home Assistant não respondeu (\(unreachable.joined(separator: "; ")))")
    }

    /// Remembers which address answered; the live updates follow it.
    private func use(_ base: String) {
        guard active != base else { return }
        let moved = active != nil
        active = base
        if moved, config != nil { listen() }
    }

    // MARK: - Live updates

    /// Subscribes to state changes of the entities the hub cares about, and says so through
    /// `onChange`. Reconnects by itself; polling covers the gaps.
    private func listen() {
        socketRetry?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        guard let config, var parts = URLComponents(string: (active ?? config.url) + "/api/websocket") else { return }
        parts.scheme = parts.scheme == "https" ? "wss" : "ws"
        guard let url = parts.url else { return }
        let task = session.webSocketTask(with: url)
        socket = task
        task.resume()
        Task { @MainActor [weak self] in
            await self?.run(task, token: config.token)
        }
    }

    private func run(_ task: URLSessionWebSocketTask, token: String) async {
        do {
            _ = try await task.receive() // auth_required
            try await task.send(.string(Self.json(["type": "auth", "access_token": token])))
            _ = try await task.receive() // auth_ok
            try await task.send(.string(Self.json(["id": 1, "type": "subscribe_events", "event_type": "state_changed"])))
            while task === socket {
                let message = try await task.receive()
                guard case .string(let text) = message,
                      let event = (try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])?["event"] as? [String: Any],
                      let entity = (event["data"] as? [String: Any])?["entity_id"] as? String,
                      watched.contains(entity), !changePending else { continue }
                // A burst of changes (a scene) becomes one read.
                changePending = true
                Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: 400_000_000)
                    self?.changePending = false
                    self?.onChange?()
                }
            }
        } catch {
            guard task === socket, config != nil else { return }
            socketRetry = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                guard !Task.isCancelled, let self else { return }
                // The address may have stopped answering (left home): find the one that does.
                _ = try? await self.request("GET", "/api/")
                guard !Task.isCancelled else { return }
                self.listen()
            }
        }
    }

    private static func json(_ object: [String: Any]) -> String {
        (try? JSONSerialization.data(withJSONObject: object)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
}
