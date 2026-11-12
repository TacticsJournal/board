import AuthenticationServices
import Capacitor
import CryptoKit
import StoreKit
import UIKit

/// Board's own native calls: Sign in with Apple, the system sign-in sheet for
/// Google, and StoreKit 2 for Pro. The JavaScript half is `src/native-account.ts`.
///
/// Nothing here decides who is signed in or who has Pro. It hands Apple's
/// answers to the web layer, which hands them to Tactics Journal, which checks
/// them with Apple itself.
@objc(BoardNativePlugin)
public class BoardNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BoardNativePlugin"
    public let jsName = "BoardNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signInWithApple", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "webAuth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "storeProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "storePurchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "storeRestore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "storeEntitlements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "storeManage", returnType: CAPPluginReturnPromise),
    ]

    private var appleDelegate: AppleSignInDelegate?
    private var webSession: ASWebAuthenticationSession?
    private var updates: Task<Void, Never>?

    override public func load() {
        // Renewals, purchases approved later (Ask to Buy) and purchases made
        // on another device arrive here. Apple expects every app that sells to
        // listen from launch.
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard case .verified(let transaction) = result else { continue }
                await transaction.finish()
                self?.notifyListeners("storeTransaction", data: ["transactionId": String(transaction.id)])
            }
        }
    }

    deinit { updates?.cancel() }

    private var presentationAnchor: ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    // MARK: Sign in with Apple

    @objc func signInWithApple(_ call: CAPPluginCall) {
        guard let nonce = call.getString("nonce"), !nonce.isEmpty else {
            call.reject("A sign-in nonce is required.")
            return
        }
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.email]
        // Apple repeats the hashed nonce inside the identity token, which is
        // how the server knows the token was made for this sign-in.
        request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()

        let delegate = AppleSignInDelegate(anchor: presentationAnchor) { [weak self] result in
            self?.appleDelegate = nil
            switch result {
            case .success(let token): call.resolve(["identityToken": token])
            case .failure(let error): call.reject(error.localizedDescription, (error as? ASAuthorizationError)?.code == .canceled ? "cancelled" : nil)
            }
        }
        appleDelegate = delegate
        DispatchQueue.main.async {
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = delegate
            controller.presentationContextProvider = delegate
            controller.performRequests()
        }
    }

    // MARK: System sign-in sheet

    @objc func webAuth(_ call: CAPPluginCall) {
        guard let string = call.getString("url"), let url = URL(string: string), url.scheme == "https",
              let scheme = call.getString("callbackScheme"), !scheme.isEmpty else {
            call.reject("A sign-in address is required.")
            return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, error in
                self?.webSession = nil
                if let callback {
                    call.resolve(["url": callback.absoluteString])
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    call.reject("cancelled", "cancelled")
                } else {
                    call.reject(error?.localizedDescription ?? "Sign-in did not finish.")
                }
            }
            session.presentationContextProvider = AnchorProvider.shared(self.presentationAnchor)
            self.webSession = session
            session.start()
        }
    }

    // MARK: StoreKit

    @objc func storeProducts(_ call: CAPPluginCall) {
        let ids = call.getArray("productIds", String.self) ?? []
        Task {
            do {
                let products = try await Product.products(for: ids)
                call.resolve(["products": products.map { product -> [String: Any] in
                    let unit = product.subscription?.subscriptionPeriod.unit
                    return [
                        "id": product.id,
                        "displayName": product.displayName,
                        "displayPrice": product.displayPrice,
                        "period": unit == .year ? "year" : unit == .month ? "month" : "",
                    ]
                }])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func storePurchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"),
              let token = call.getString("appAccountToken").flatMap(UUID.init(uuidString:)) else {
            call.reject("A product and account are required.")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else {
                    call.reject("This plan is not available in the App Store right now.")
                    return
                }
                // The account token is how Tactics Journal knows which account
                // made the purchase; Apple stores it on the transaction.
                let result = try await product.purchase(options: [.appAccountToken(token)])
                switch result {
                case .success(.verified(let transaction)):
                    await transaction.finish()
                    call.resolve(["status": "purchased", "transactionId": String(transaction.id)])
                case .success(.unverified):
                    call.reject("The App Store could not confirm this purchase.")
                case .pending:
                    call.resolve(["status": "pending"])
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                @unknown default:
                    call.resolve(["status": "cancelled"])
                }
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    private func currentTransactionIds() async -> [String] {
        var ids: [String] = []
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result, transaction.productType == .autoRenewable {
                ids.append(String(transaction.id))
            }
        }
        return ids
    }

    @objc func storeRestore(_ call: CAPPluginCall) {
        Task {
            do {
                // Asks the person to confirm their Apple Account, then brings
                // this device's purchase records up to date.
                try await AppStore.sync()
                call.resolve(["transactionIds": await currentTransactionIds()])
            } catch StoreKitError.userCancelled {
                call.reject("cancelled", "cancelled")
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func storeEntitlements(_ call: CAPPluginCall) {
        Task { call.resolve(["transactionIds": await currentTransactionIds()]) }
    }

    @objc func storeManage(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let scene = self.bridge?.viewController?.view.window?.windowScene else {
                call.reject("Subscriptions cannot be opened right now.")
                return
            }
            do {
                try await AppStore.showManageSubscriptions(in: scene)
                call.resolve()
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }
}

private final class AppleSignInDelegate: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private let anchor: ASPresentationAnchor
    private let done: (Result<String, Error>) -> Void

    init(anchor: ASPresentationAnchor, done: @escaping (Result<String, Error>) -> Void) {
        self.anchor = anchor
        self.done = done
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { anchor }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let data = credential.identityToken, let token = String(data: data, encoding: .utf8) else {
            done(.failure(ASAuthorizationError(.failed)))
            return
        }
        done(.success(token))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        done(.failure(error))
    }
}

private final class AnchorProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    private static var current: AnchorProvider?
    private let anchor: ASPresentationAnchor

    private init(_ anchor: ASPresentationAnchor) { self.anchor = anchor }

    static func shared(_ anchor: ASPresentationAnchor) -> AnchorProvider {
        let provider = AnchorProvider(anchor)
        current = provider
        return provider
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor }
}

/// The app's web view controller: Capacitor's, with Board's own plugin added.
class BoardViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(BoardNativePlugin())
    }
}
