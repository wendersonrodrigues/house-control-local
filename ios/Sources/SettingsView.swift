import SwiftUI
import UniformTypeIdentifiers
import HouseCore

/// Ajustes do HomeOs: a planta mostrada, a conexão com o Home Assistant e a versão.
/// O que o House Control oferece além disso (Smart Life, Hue, Apple Home, Mac, atalhos) fica no
/// código, escondido (Edition.swift), para o fork continuar acompanhando o original.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var importing = false
    @State private var problem: String?

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.settingsPath) {
            ScrollView {
                VStack(spacing: 30) {
                    connectionSection
                    homeSection
                    aboutSection
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)
                .padding(.bottom, 32)
                .readableWidth()
            }
            .background(Theme.background)
            .navigationTitle("Ajustes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("OK") { dismiss() }.fontWeight(.semibold)
                }
            }
            .navigationDestination(for: SettingsRoute.self) { route in
                switch route {
                case .homeAssistant: HomeAssistantView()
                case .devices: DevicesView()
                case .quickActions: QuickActionsView()
                case .pairing: PairingView()
                case .hue: HueView()
                #if SMART_LIFE
                case .smartLife: SmartLifeView()
                #else
                case .smartLife: EmptyView()
                #endif
                }
            }
        }
        .presentationBackground(Theme.background)
        .presentationDragIndicator(.visible)
        .preferredColorScheme(.dark)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            do { try model.importPlan(from: try result.get()) }
            catch { problem = error.localizedDescription }
        }
        .alert("Não foi possível abrir esta planta", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(problem ?? "") }
    }

    // MARK: - Home Assistant

    private var connectionSection: some View {
        VStack(spacing: 10) {
            SectionTitle("Conexão")
            Card {
                NavigationLink(value: SettingsRoute.homeAssistant) {
                    HStack(spacing: 14) {
                        IconBadge(symbol: "server.rack", tint: ConnectionLook.homeAssistant)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Home Assistant").font(.system(size: 16.5, weight: .semibold)).foregroundStyle(Theme.text)
                            HStack(spacing: 7) {
                                if model.homeAssistantName != nil { StatusDot(color: Theme.green, pulsing: false) }
                                Text(haDetail).font(.system(size: 13.5)).foregroundStyle(Theme.muted).lineLimit(2)
                            }
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.faint)
                    }
                    .padding(.horizontal, 14)
                    .frame(minHeight: 70)
                    .contentShape(Rectangle())
                }
                .buttonStyle(RowButtonStyle())
            }
        }
    }

    private var haDetail: String {
        guard let name = model.homeAssistantName else { return "Toque para conectar" }
        let info = model.homeAssistantInfo
        return info["away"] as? Bool == true ? "\(name) · pelo endereço externo" : name
    }

    // MARK: - Planta

    private var homeSection: some View {
        VStack(spacing: 10) {
            SectionTitle("Casa")
            Card {
                planRow("homeos", name: "Casa", detail: "Planta do app, ligada aos aparelhos reais", symbol: "house.fill", tint: Theme.warm)
                if model.hasCustomPlan {
                    RowDivider()
                    planRow("custom", name: model.customPlanName ?? "Minha casa", detail: "Salva no editor deste aparelho",
                            symbol: "pencil.and.ruler.fill", tint: Theme.accent)
                }
                RowDivider()
                planRow("home", name: "Demonstração · Apartamento", detail: "Aparelhos simulados", symbol: "building.2.fill", tint: Theme.muted)
            }
            Card {
                Button { model.openEditor() } label: {
                    HStack(spacing: 14) {
                        IconBadge(symbol: "pencil.and.ruler.fill", tint: Theme.accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Editar casa").font(.system(size: 16.5, weight: .semibold)).foregroundStyle(Theme.text)
                            Text("Cômodos, luzes, ar-condicionado, móveis").font(.system(size: 13.5)).foregroundStyle(Theme.muted).lineLimit(1)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.faint)
                    }
                    .padding(.horizontal, 14)
                    .frame(minHeight: 66)
                    .contentShape(Rectangle())
                }
                .buttonStyle(RowButtonStyle())
            }
            Button { importing = true } label: { Label("Importar planta (arquivo .json)", systemImage: "square.and.arrow.down") }
                .buttonStyle(SecondaryButtonStyle())
            footnote("A planta “Casa” é a mesma do app do Mac (homeos.json). Editar aqui cria uma cópia só deste aparelho.")
        }
    }

    private func planRow(_ id: String, name: String, detail: String, symbol: String, tint: Color) -> some View {
        Button { model.selectPlan(id) } label: {
            HStack(spacing: 14) {
                IconBadge(symbol: symbol, tint: tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).font(.system(size: 16.5, weight: .semibold)).foregroundStyle(Theme.text)
                    Text(detail).font(.system(size: 13.5)).foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 8)
                Image(systemName: model.activePlan == id ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(model.activePlan == id ? Theme.accent : Theme.faint)
                    .contentTransition(.symbolEffect(.replace))
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 66)
        }
        .buttonStyle(RowButtonStyle())
        .accessibilityAddTraits(model.activePlan == id ? .isSelected : [])
    }

    // MARK: - Sobre

    private var aboutSection: some View {
        VStack(spacing: 10) {
            SectionTitle("Sobre")
            Card {
                infoRow("Versão", value: version)
                RowDivider().padding(.leading, -52)
                infoRow("Privacidade", value: "Sem conta, sem análises")
            }
            footnote("\(Edition.name) fala só com o seu Home Assistant. Nada mais sai deste aparelho. Baseado no House Control (MIT).")
        }
    }

    private var version: String {
        let info = Bundle.main.infoDictionary
        return "\(info?["CFBundleShortVersionString"] as? String ?? "–") (\(info?["CFBundleVersion"] as? String ?? "–"))"
    }

    private func infoRow(_ title: String, value: String) -> some View {
        HStack {
            Text(title).font(.system(size: 16)).foregroundStyle(Theme.text)
            Spacer()
            Text(value).font(.system(size: 15)).foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
    }

    private func footnote(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 13))
            .foregroundStyle(Theme.faint)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 6)
            .fixedSize(horizontal: false, vertical: true)
    }
}
