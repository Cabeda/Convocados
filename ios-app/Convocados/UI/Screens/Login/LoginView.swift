import SwiftUI

struct LoginView: View {
    @StateObject private var viewModel: LoginViewModel
    @EnvironmentObject private var authManager: AuthManager

    init(authManager: AuthManager) {
        _viewModel = StateObject(wrappedValue: LoginViewModel(authManager: authManager))
    }

    var body: some View {
        VStack(spacing: 32) {
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
            }

            if let error = viewModel.error {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.appError)
                    .padding(.horizontal)
            }

            Spacer().frame(height: 40)
        }
    }
}
