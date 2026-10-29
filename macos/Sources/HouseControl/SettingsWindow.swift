import AppKit
import SwiftUI
import HouseCore

/// What the Settings window shows. The app delegate fills it in whenever the window comes up
/// or something it shows changes, and carries out what it asks for.
@MainActor
final class SettingsModel: ObservableObject {
    struct Plan: Identifiable, Hashable {
        let id: String
        let name: String
    }

    struct Connection: Identifiable {
        let id: String
        let name: String
        let symbol: String
        let tint: Color
        let detail: String
        let connected: Bool
    }

    @Published var openAtLogin: LoginItem.State = .off
    @Published var islandShown = false
    @Published var plans: [Plan] = []
    @Published var activePlan = PlanStore.defaultPlan
    @Published var connections: [Connection] = []
    @Published var phones: [String] = []
    @Published var aiLive = false

    var setOpenAtLogin: (Bool) -> Void = { _ in }
    var setIsland: (Bool) -> Void = { _ in }
    var selectPlan: (String) -> Void = { _ in }
    var editHome: () -> Void = {}
    var loadPlan: () -> Void = {}
    var revealPlan: () -> Void = {}
    var openConnection: (String) -> Void = { _ in }
    var pairPhone: () -> Void = {}
    var openAgent: () -> Void = {}
    var stopAgent: () -> Void = {}
    var revealLog: () -> Void = {}
}

/// HomeOs Bar → Ajustes… (⌘,): the app's options in one window, the way every Mac app has
/// them. The panel's gear menu and the menu bar icon's right-click menu lead here too.
@MainActor
final class SettingsWindowController: NSWindowController {
    let model = SettingsModel()
    var onShow: (() -> Void)?

    init() {
        let tabs = NSTabViewController()
        tabs.tabStyle = .toolbar
        // (id for show(pane:), title, symbol, view); the phone and AI panes only where the edition has them.
        var panes: [(String, String, String, AnyView)] = [
            ("General", "Geral", "gearshape", AnyView(GeneralPane())),
            ("Home", "Casa", "house", AnyView(HomePane())),
            ("Connections", "Conexões", "point.3.connected.trianglepath.dotted", AnyView(ConnectionsPane())),
        ]
        if Edition.phones { panes.append(("Phone", "Celular", "iphone", AnyView(PhonePane()))) }
        if Edition.aiAccess { panes.append(("AI Access", "Acesso por IA", "sparkles", AnyView(AgentPane()))) }
        panes.append(("About", "Sobre", "info.circle", AnyView(AboutPane())))
        for (id, title, symbol, view) in panes {
            let host = NSHostingController(rootView: view.environmentObject(model))
            host.sizingOptions = .preferredContentSize
            host.title = title // the tab controller names the window after the pane on show
            let item = NSTabViewItem(viewController: host)
            item.identifier = id
            item.label = title
            item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: title)
            tabs.addTabViewItem(item)
        }
        let window = NSWindow(contentViewController: tabs)
        window.styleMask = [.titled, .closable]
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("HomeOsBarSettings")
        super.init(window: window)
    }

    /// The window as a PNG, drawn without the screen (HOUSE_SNAPSHOT_DIR).
    func snapshot(to url: URL) {
        guard let view = window?.contentView?.superview ?? window?.contentView,
              let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    func show(pane: String? = nil) {
        onShow?()
        if let tabs = window?.contentViewController as? NSTabViewController {
            let index = pane.flatMap { p in tabs.tabViewItems.firstIndex { $0.identifier as? String == p } }
                ?? tabs.selectedTabViewItemIndex
            // The first pane is laid out before the window exists and comes up pushed down, its
            // end cut off. Selecting it afresh sizes the window to it like the others.
            if tabs.tabViewItems.count > 1, index == tabs.selectedTabViewItemIndex {
                tabs.selectedTabViewItemIndex = (index + 1) % tabs.tabViewItems.count
            }
            tabs.selectedTabViewItemIndex = index
        }
        NSApp.activate(ignoringOtherApps: true)
        if window?.isVisible != true { window?.center() }
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
    }
}

// MARK: - Panes

/// One pane: a grouped form of a fixed width, the height of what is in it.
private struct Pane<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        // Not a grouped Form: on recent macOS it lays its rows out well below the top of the
        // pane (and cuts off the bottom), whatever its margins say. Cards look the same.
        VStack(alignment: .leading, spacing: 18) { content }
            .labeledContentStyle(RowStyle())
            .padding(20)
            .frame(width: 500, alignment: .topLeading)
            .fixedSize(horizontal: false, vertical: true)
            // The tab view can hand a pane more height than it asked for (more than the window
            // shows): keep the pane at the top of it rather than in the middle.
            .frame(maxHeight: .infinity, alignment: .top)
    }
}

private struct GeneralPane: View {
    @EnvironmentObject var model: SettingsModel

    var body: some View {
        Pane {
            Card {
                SwitchRow("Abrir ao iniciar sessão", isOn: Binding(get: { model.openAtLogin == .on }, set: model.setOpenAtLogin))
                if model.openAtLogin == .needsApproval {
                    LabeledContent {
                        Button("Abrir Itens de Início…") { model.setOpenAtLogin(true) }
                    } label: {
                        Text("Aguardando sua permissão em Ajustes do Sistema → Geral → Itens de Início.")
                            .foregroundStyle(.secondary)
                    }
                }
            } footer: {
                Footnote("O HomeOs Bar abre junto com o Mac e fica esperando na barra de menu.")
            }
            Card {
                SwitchRow("Mostrar a Ilha", isOn: Binding(get: { model.islandShown }, set: model.setIsland))
            } footer: {
                Footnote("Luzes acesas, ar-condicionado, portão e atalhos num relance, no meio da barra de menu. Clique para abrir.")
            }
            Card(title: "Como usar") {
                Tip(symbol: "cursorarrow.click", text: "Clique na casinha da barra de menu para abrir o painel.")
                Tip(symbol: "contextualmenu.and.cursorarrow", text: "Clique com o botão direito para o menu: editor da casa, planta e registro.")
                Tip(symbol: "command", text: "⌘, abre estes ajustes de qualquer janela do HomeOs Bar.")
            }
        }
    }
}

private struct HomePane: View {
    @EnvironmentObject var model: SettingsModel

    var body: some View {
        Pane {
            Card {
                Picker("Planta", selection: Binding(get: { model.activePlan }, set: model.selectPlan)) {
                    ForEach(model.plans) { Text($0.name).tag($0.id) }
                }
                .pickerStyle(.radioGroup)
            } footer: {
                Footnote("Desenhe sua casa no editor ou carregue um arquivo de planta. As demonstrações são simuladas: nada de verdade é acionado.")
            }
            Card {
                ActionRow(symbol: "pencil.and.ruler", title: "Editar casa…", detail: "Cômodos, luzes, ares, portão, atalhos e chaves", action: model.editHome)
                ActionRow(symbol: "square.and.arrow.down", title: "Carregar planta…", detail: "Um arquivo de planta de outro Mac ou de um backup", action: model.loadPlan)
                ActionRow(symbol: "folder", title: "Mostrar arquivo da planta", detail: "A planta em JSON, no Finder", action: model.revealPlan)
            }
        }
    }
}

private struct ConnectionsPane: View {
    @EnvironmentObject var model: SettingsModel

    var body: some View {
        Pane {
            Card {
                ForEach(model.connections) { connection in
                    LabeledContent {
                        Button(connection.connected ? "Gerenciar…" : "Conectar…") { model.openConnection(connection.id) }
                    } label: {
                        HStack(spacing: 10) {
                            Badge(symbol: connection.symbol, tint: connection.tint)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(connection.name)
                                HStack(spacing: 5) {
                                    Circle().fill(connection.connected ? Color.green : Color.secondary.opacity(0.5))
                                        .frame(width: 6, height: 6)
                                    Text(connection.detail).foregroundStyle(.secondary).font(.callout)
                                }
                            }
                        }
                    }
                }
            } footer: {
                Footnote("A conexão é feita no editor, onde você também vincula cada luz, ar, portão, atalho e chave à entidade real do Home Assistant.")
            }
        }
    }
}

private struct PhonePane: View {
    @EnvironmentObject var model: SettingsModel

    var body: some View {
        Pane {
            Card {
                if model.phones.isEmpty {
                    Label("Nenhum celular conectado agora", systemImage: "iphone.slash").foregroundStyle(.secondary)
                } else {
                    ForEach(model.phones, id: \.self) { phone in
                        Label { Text(phone) } icon: { Image(systemName: "iphone").foregroundStyle(.green) }
                    }
                }
                ActionRow(symbol: "qrcode", title: "Parear celular…", detail: "Mostra o código para ler com o House Control num Android ou iPhone", action: model.pairPhone)
            } footer: {
                Footnote("Pareado, o celular recebe esta planta e as conexões e fica sincronizado com o Mac. Ele continua conectado enquanto o app estiver aberto.")
            }
        }
    }
}

private struct AgentPane: View {
    @EnvironmentObject var model: SettingsModel

    var body: some View {
        Pane {
            Card {
                LabeledContent {
                    if model.aiLive { Button("Parar", role: .destructive, action: model.stopAgent) }
                } label: {
                    HStack(spacing: 10) {
                        Badge(symbol: "sparkles", tint: .purple)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Acesso por IA")
                            Text(model.aiLive ? "Ativo: um assistente pode controlar sua casa" : "Desligado")
                                .foregroundStyle(model.aiLive ? .green : .secondary).font(.callout)
                        }
                    }
                }
                ActionRow(symbol: "link", title: "Abrir Acesso por IA…", detail: "O link e o que o assistente pode fazer", action: model.openAgent)
            } footer: {
                Footnote("Um link privado que permite a um assistente de IA, como Claude ou ChatGPT, ver e controlar sua casa, com os limites que você escolher. Termina quando você parar ou fechar o app.")
            }
        }
    }
}

private struct AboutPane: View {
    @EnvironmentObject var model: SettingsModel
    private let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    private let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""

    var body: some View {
        Pane {
            Card {
                HStack(spacing: 14) {
                    Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 56, height: 56)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(Edition.name).font(.title3.weight(.semibold))
                        Text(version.isEmpty ? "Versão de desenvolvimento" : "Versão \(version)\(build.isEmpty || build == version ? "" : " (\(build))")")
                            .foregroundStyle(.secondary)
                        Text("Sua casa como uma maquete 3D ao vivo, na barra de menu. Baseado no House Control.").foregroundStyle(.secondary).font(.callout)
                    }
                }
                .padding(.vertical, 4)
            }
            Card {
                LinkRow(symbol: "shippingbox", title: "Código deste fork", url: About.forkSource)
                LinkRow(symbol: "globe", title: "House Control, o projeto original", url: About.source)
                LinkRow(symbol: "at", title: "\(About.developer) no X", url: About.x)
            }
            Card {
                ActionRow(symbol: "doc.text.magnifyingglass", title: "Mostrar registro dos dispositivos", detail: "O que foi enviado aos dispositivos, para investigar problemas", action: model.revealLog)
            }
        }
    }
}

// MARK: - Pieces

/// A group of rows on a rounded card, with an optional title above and note below.
private struct Card<Content: View, Footer: View>: View {
    var title: String?
    @ViewBuilder var content: Content
    @ViewBuilder var footer: Footer

    init(title: String? = nil, @ViewBuilder content: () -> Content, @ViewBuilder footer: () -> Footer) {
        self.title = title
        self.content = content()
        self.footer = footer()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let title { Text(title).font(.headline).padding(.leading, 4) }
            VStack(alignment: .leading, spacing: 12) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.primary.opacity(0.045)))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.primary.opacity(0.08)))
            footer.padding(.horizontal, 4)
        }
    }
}

extension Card where Footer == EmptyView {
    init(title: String? = nil, @ViewBuilder content: () -> Content) {
        self.init(title: title, content: content, footer: { EmptyView() })
    }
}

/// Label at the start, control at the far end.
private struct RowStyle: LabeledContentStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 12) { configuration.label; Spacer(minLength: 8); configuration.content }
    }
}

/// A label with its switch at the far end, the way a settings row has it.
private struct SwitchRow: View {
    let title: String
    @Binding var isOn: Bool
    init(_ title: String, isOn: Binding<Bool>) { self.title = title; _isOn = isOn }

    var body: some View {
        HStack { Text(title); Spacer(); Toggle("", isOn: $isOn).labelsHidden().toggleStyle(.switch) }
    }
}

private struct Footnote: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }
}

private struct Badge: View {
    let symbol: String
    let tint: Color

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 26, height: 26)
            .background(tint.gradient, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

private struct Tip: View {
    let symbol: String
    let text: String

    var body: some View {
        Label { Text(text) } icon: { Image(systemName: symbol).foregroundStyle(.secondary) }
    }
}

/// A row that does something: a title and what it is for, and the whole row is the button.
private struct ActionRow: View {
    let symbol: String
    let title: String
    let detail: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol).frame(width: 20).foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                    Text(detail).font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct LinkRow: View {
    let symbol: String
    let title: String
    let url: URL

    var body: some View {
        Link(destination: url) {
            HStack(spacing: 10) {
                Image(systemName: symbol).frame(width: 20).foregroundStyle(.secondary)
                Text(title).foregroundStyle(.primary)
                Spacer()
                Image(systemName: "arrow.up.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
