import SwiftUI
import WidgetKit
import AppIntents
import HouseCore

// Controls: Control Center, the Lock Screen and the Action button on the iPhone (iOS 18),
// Control Center and the menu bar on the Mac (macOS 26).

// MARK: - Intents the controls run (also offered to Shortcuts)

struct SetLightIntent: SetValueIntent {
    static let title: LocalizedStringResource = "Acender ou apagar uma luz"
    static let description = IntentDescription("Acende ou apaga uma luz do HomeOs Bar.")
    @Parameter(title: "Luz") var light: LightEntity
    @Parameter(title: "Ligado") var value: Bool

    init() {}
    init(light: LightEntity) { self.light = light }

    func perform() async throws -> some IntentResult {
        await WidgetActions.run(.light(light.id, on: value))
        return .result()
    }
}

struct SetAllLightsIntent: SetValueIntent {
    static let title: LocalizedStringResource = "Acender ou apagar todas as luzes"
    static let description = IntentDescription("Acende ou apaga todas as luzes da casa.")
    @Parameter(title: "Ligado") var value: Bool

    init() {}

    func perform() async throws -> some IntentResult {
        await WidgetActions.run(.allLights(on: value))
        return .result()
    }
}

struct SetClimateIntent: SetValueIntent {
    static let title: LocalizedStringResource = "Ligar ou desligar um ar-condicionado"
    static let description = IntentDescription("Liga ou desliga um ar-condicionado do HomeOs Bar.")
    @Parameter(title: "Ar-condicionado") var ac: ACEntity
    @Parameter(title: "Ligado") var value: Bool

    init() {}
    init(ac: ACEntity) { self.ac = ac }

    func perform() async throws -> some IntentResult {
        await WidgetActions.run(.acPower(ac.id, on: value))
        return .result()
    }
}

struct RunSceneIntent: AppIntent {
    static let title: LocalizedStringResource = "Aplicar uma cena"
    static let description = IntentDescription("Deixa luzes e ares do jeito que a cena define.")
    @Parameter(title: "Cena") var scene: SceneEntity

    init() {}
    init(scene: SceneEntity) { self.scene = scene }

    func perform() async throws -> some IntentResult {
        await WidgetActions.run(.scene(scene.id))
        return .result()
    }
}

// MARK: - Control configuration

@available(iOS 18.0, macOS 26.0, *)
struct LightControlConfiguration: ControlConfigurationIntent {
    static let title: LocalizedStringResource = "Luz"
    @Parameter(title: "Luz") var light: LightEntity?
}

@available(iOS 18.0, macOS 26.0, *)
struct ClimateControlConfiguration: ControlConfigurationIntent {
    static let title: LocalizedStringResource = "Ar-condicionado"
    @Parameter(title: "Ar-condicionado") var ac: ACEntity?
}

@available(iOS 18.0, macOS 26.0, *)
struct SceneControlConfiguration: ControlConfigurationIntent {
    static let title: LocalizedStringResource = "Cena"
    @Parameter(title: "Cena") var scene: SceneEntity?
}

// MARK: - Controls

@available(iOS 18.0, macOS 26.0, *)
struct LightControl: ControlWidget {
    static let kind = "io.github.0xprobabillity.HouseControl.light-control"

    struct Value {
        var light: LightEntity?
        var isOn: Bool
    }

    struct Provider: AppIntentControlValueProvider {
        func previewValue(configuration: LightControlConfiguration) -> Value {
            Value(light: configuration.light, isOn: true)
        }

        func currentValue(configuration: LightControlConfiguration) async throws -> Value {
            let home = HomeData.orSample
            let id = configuration.light?.id ?? home.lights.first?.id
            let light = id.flatMap(home.light)
            return Value(light: configuration.light ?? light.map { LightEntity($0, in: home) }, isOn: light?.on ?? false)
        }
    }

    var body: some ControlWidgetConfiguration {
        AppIntentControlConfiguration(kind: Self.kind, provider: Provider()) { value in
            ControlWidgetToggle(value.light?.name ?? "Light", isOn: value.isOn,
                                action: value.light.map(SetLightIntent.init(light:)) ?? SetLightIntent()) { on in
                Label(on ? "Acesa" : "Apagada", systemImage: on ? "lightbulb.fill" : "lightbulb")
            }
            .tint(.orange)
        }
        .displayName("Luz")
        .description("Acende ou apaga uma luz.")
        .promptsForUserConfiguration()
    }
}

@available(iOS 18.0, macOS 26.0, *)
struct AllLightsControl: ControlWidget {
    static let kind = "io.github.0xprobabillity.HouseControl.all-lights-control"

    struct Provider: ControlValueProvider {
        var previewValue: Bool { true }
        func currentValue() async throws -> Bool { (HomeData.current?.lightsOn ?? 0) > 0 }
    }

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind, provider: Provider()) { isOn in
            ControlWidgetToggle("Todas as luzes", isOn: isOn, action: SetAllLightsIntent()) { on in
                Label(on ? "Acesas" : "Apagadas", systemImage: on ? "lightbulb.2.fill" : "lightbulb.2")
            }
            .tint(.orange)
        }
        .displayName("Todas as luzes")
        .description("Todas as luzes da casa de uma vez.")
    }
}

@available(iOS 18.0, macOS 26.0, *)
struct ClimateControl: ControlWidget {
    static let kind = "io.github.0xprobabillity.HouseControl.climate-control"

    struct Value {
        var ac: ACEntity?
        var isOn: Bool
        var label: String
    }

    struct Provider: AppIntentControlValueProvider {
        func previewValue(configuration: ClimateControlConfiguration) -> Value {
            Value(ac: configuration.ac, isOn: true, label: "Gelar 23°")
        }

        func currentValue(configuration: ClimateControlConfiguration) async throws -> Value {
            let home = HomeData.orSample
            let ac = (configuration.ac?.id ?? home.acs.first?.id).flatMap(home.ac)
            return Value(ac: configuration.ac ?? ac.map { ACEntity($0, in: home) }, isOn: ac?.on ?? false,
                         label: ac.map { $0.on ? "\($0.modeName) \($0.targetText)" : "Desligado" } ?? "Desligado")
        }
    }

    var body: some ControlWidgetConfiguration {
        AppIntentControlConfiguration(kind: Self.kind, provider: Provider()) { value in
            ControlWidgetToggle(value.ac?.name ?? "Ar-condicionado", isOn: value.isOn,
                                action: value.ac.map(SetClimateIntent.init(ac:)) ?? SetClimateIntent()) { on in
                Label(on ? value.label : "Desligado", systemImage: on ? "snowflake" : "air.conditioner.horizontal")
            }
            .tint(.cyan)
        }
        .displayName("Ar-condicionado")
        .description("Liga ou desliga um ar-condicionado.")
        .promptsForUserConfiguration()
    }
}

@available(iOS 18.0, macOS 26.0, *)
struct SceneControl: ControlWidget {
    static let kind = "io.github.0xprobabillity.HouseControl.scene-control"

    var body: some ControlWidgetConfiguration {
        AppIntentControlConfiguration(kind: Self.kind, intent: SceneControlConfiguration.self) { configuration in
            ControlWidgetButton(action: configuration.scene.map(RunSceneIntent.init(scene:)) ?? RunSceneIntent()) {
                Label(configuration.scene?.name ?? "Cena", systemImage: configuration.scene?.symbol ?? "sparkles")
            }
        }
        .displayName("Cena")
        .description("Aplica uma cena com um toque.")
        .promptsForUserConfiguration()
    }
}

#if os(iOS)
@available(iOS 18.0, *)
struct OpenControlConfiguration: ControlConfigurationIntent {
    static let title: LocalizedStringResource = "HomeOs Bar"
    @Parameter(title: "Abrir", default: .home) var screen: AppScreen
}

/// A button that opens the app: on the home in 3D (and says how it is), the editor or settings.
@available(iOS 18.0, *)
struct OpenAppControl: ControlWidget {
    static let kind = "io.github.0xprobabillity.HouseControl.open-control"

    struct Value {
        var screen: AppScreen
        var status: String
        var lit: Bool
    }

    struct Provider: AppIntentControlValueProvider {
        func previewValue(configuration: OpenControlConfiguration) -> Value {
            value(configuration.screen, home: HomeData.orSample)
        }

        func currentValue(configuration: OpenControlConfiguration) async throws -> Value {
            value(configuration.screen, home: HomeData.current)
        }

        private func value(_ screen: AppScreen, home: HomeSnapshot?) -> Value {
            switch screen {
            case .home:
                guard let home else { return Value(screen: screen, status: "Open", lit: false) }
                // Short enough for the wide tile: "6 on · AC 23°", "2 lights on", "Lights off".
                let ac = home.acsOn.first
                let lights = home.lightsOn == 0 ? "Luzes apagadas"
                    : ac == nil ? "\(home.lightsOn) \(home.lightsOn == 1 ? "luz acesa" : "luzes acesas")" : "\(home.lightsOn) acesas"
                let status = ac.map { "\(lights) · Ar \($0.targetText)" } ?? lights
                return Value(screen: screen, status: status, lit: home.lightsOn > 0 || ac != nil)
            case .editor: return Value(screen: screen, status: "Planta", lit: false)
            case .settings: return Value(screen: screen, status: "Settings", lit: false)
            }
        }
    }

    var body: some ControlWidgetConfiguration {
        AppIntentControlConfiguration(kind: Self.kind, provider: Provider()) { value in
            ControlWidgetButton(action: OpenHouseControlIntent(screen: value.screen)) {
                Label {
                    Text("HomeOs Bar")
                    Text(value.status)
                } icon: {
                    Image(systemName: value.screen == .home && !value.lit ? "house" : value.screen.symbol)
                }
            }
            .tint(Palette.warm)
        }
        .displayName("HomeOs Bar")
        .description("Abre o app: a casa em 3D, a planta ou os ajustes.")
    }
}
#endif
