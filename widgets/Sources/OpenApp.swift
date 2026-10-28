#if os(iOS)
import AppIntents
import Foundation

// Opening the app from a control (Control Center, the Lock Screen, the Action button) and from
// Shortcuts. This file is part of the app as well as of the widget extension: an intent that
// opens the app has to be known to both, and the system runs it in the app.

/// Where the app opens.
enum AppScreen: String, AppEnum {
    case home, editor, settings

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Tela"
    static let caseDisplayRepresentations: [AppScreen: DisplayRepresentation] = [
        .home: DisplayRepresentation(title: "Casa", subtitle: "A casa em 3D", image: .init(systemName: "house.fill")),
        .editor: DisplayRepresentation(title: "Planta", subtitle: "O editor", image: .init(systemName: "pencil.and.ruler.fill")),
        .settings: DisplayRepresentation(title: "Ajustes", subtitle: "Conexões e opções", image: .init(systemName: "gearshape.fill")),
    ]

    var symbol: String {
        switch self {
        case .home: "house.fill"
        case .editor: "pencil.and.ruler.fill"
        case .settings: "gearshape.fill"
        }
    }
}

/// Hands the screen an intent asks for to the app. The intent runs in the app's own process
/// (`openAppWhenRun`), so the app's model takes it from here; one that comes before the model
/// is ready waits in `pending`.
@MainActor
enum OpenAppRouter {
    static var handler: ((AppScreen) -> Void)? {
        didSet {
            guard let handler, let screen = pending else { return }
            pending = nil
            handler(screen)
        }
    }
    static var pending: AppScreen?

    static func open(_ screen: AppScreen) {
        if let handler { handler(screen) } else { pending = screen }
    }
}

@available(iOS 18.0, *)
struct OpenHouseControlIntent: AppIntent {
    static let title: LocalizedStringResource = "Abrir o HomeOs Bar"
    static let description = IntentDescription("Abre o HomeOs Bar na casa, no editor da planta ou nos ajustes.")
    static let openAppWhenRun = true

    @Parameter(title: "Tela", default: .home) var screen: AppScreen

    init() {}
    init(screen: AppScreen) { self.screen = screen }

    static var parameterSummary: some ParameterSummary { Summary("Abrir o HomeOs Bar em \(\.$screen)") }

    @MainActor
    func perform() async throws -> some IntentResult {
        OpenAppRouter.open(screen)
        return .result()
    }
}
#endif
