import SwiftUI

struct LoginView: View {
    @StateObject private var viewModel: LoginViewModel
    @EnvironmentObject private var authManager: AuthManager
    @EnvironmentObject private var settings: SettingsStore
    @State private var showServerSettings = false
    @State private var serverUrl = ""

    init(authManager: AuthManager) {
        _viewModel = StateObject(wrappedValue: LoginViewModel(authManager: authManager))
    }

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "sportscourt")
                .font(.system(size: 80))
                .foregroundColor(.appPrimary)

            Text("Convocados")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("Organize pickup sports games in seconds")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            Spacer()

            VStack(spacing: 16) {
                TextField("Email", text: $viewModel.email)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .autocapitalization(.none)
                    .autocorrectionDisabled()

                SecureField("Password", text: $viewModel.password)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.password)
            }
            .padding(.horizontal, 32)

            if viewModel.isLoading {
                ProgressView()
            } else {
                Button(action: {
                    Task { await viewModel.login() }
                }) {
                    Label("Sign In", systemImage: "person.badge.key")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.appPrimary)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                }
                .padding(.horizontal, 32)
                .disabled(viewModel.email.isEmpty || viewModel.password.isEmpty)
                .opacity(viewModel.email.isEmpty || viewModel.password.isEmpty ? 0.5 : 1)
            }

            if let error = viewModel.error {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.appError)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            Button {
                serverUrl = settings.serverUrl
                showServerSettings.toggle()
            } label: {
                Label("Server URL", systemImage: "server.rack")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
            .padding(.top, 8)

            if showServerSettings {
                VStack(spacing: 8) {
                    TextField("Server URL", text: $serverUrl)
                        .textFieldStyle(.roundedBorder)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()

                    HStack {
                        Button("Cancel") {
                            showServerSettings = false
                        }
                        .font(.footnote)
                        .foregroundColor(.secondary)

                        Spacer()

                        Button("Save") {
                            let trimmed = serverUrl.trimmingCharacters(in: .whitespacesAndNewlines)
                            if !trimmed.isEmpty {
                                settings.serverUrl = trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                            }
                            showServerSettings = false
                        }
                        .font(.footnote.weight(.semibold))
                    }
                }
                .padding(.horizontal, 32)
            }

            Spacer().frame(height: 40)
        }
    }
}