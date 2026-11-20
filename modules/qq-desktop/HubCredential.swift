import Foundation

enum HubCredential {
    static func key() -> String? {
        let file = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/CodexRemoteContact/napcat-state/desktop.key")
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return nil }
        let key = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard key.utf8.count == 64, key.allSatisfy({ "0123456789abcdef".contains($0) }) else { return nil }
        return key
    }

    static func respond(to challenge: URLAuthenticationChallenge,
                        completion: (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let space = challenge.protectionSpace
        guard space.protocol == "http", space.host == "127.0.0.1", space.port == 3789,
              !space.isProxy(), space.realm == "QQ Hub",
              space.authenticationMethod == NSURLAuthenticationMethodHTTPBasic else {
            completion(.performDefaultHandling, nil)
            return
        }
        guard challenge.previousFailureCount == 0, let key = key() else {
            completion(.cancelAuthenticationChallenge, nil)
            return
        }
        completion(.useCredential, URLCredential(user: "qq", password: key, persistence: .forSession))
    }
}
