// Run without launching Runner/Firebase: swiftc ios/Runner/AppUpdateInstallation.swift
// test/native_app_update/main.swift -o /tmp/bitestar-update-native-tests && /tmp/bitestar-update-native-tests
import Foundation
import CryptoKit
func equal<T: Equatable>(_ a: T, _ b: T, file: StaticString = #file, line: UInt = #line) {
  precondition(a == b, "Expected equal values", file: file, line: line)
}
func truth(_ value: Bool, file: StaticString = #file, line: UInt = #line) {
  precondition(value, "Expected true", file: file, line: line)
}
func falsity(_ value: Bool, file: StaticString = #file, line: UInt = #line) {
  precondition(!value, "Expected false", file: file, line: line)
}
func absent<T>(_ value: T?, file: StaticString = #file, line: UInt = #line) {
  precondition(value == nil, "Expected nil", file: file, line: line)
}

final class AppUpdateInstallationTests {
  func testStorefrontMappingDoesNotUsePhoneLocale() {
    equal(AppUpdateInstallation.country(alpha3: "USA"), "US")
    equal(AppUpdateInstallation.country(alpha3: "CAN"), "CA")
    equal(AppUpdateInstallation.country(alpha3: "GBR"), "GB")
    equal(AppUpdateInstallation.country(alpha3: "FRA"), "FR")
    absent(AppUpdateInstallation.country(alpha3: "ZZZ"))
    absent(AppUpdateInstallation.country(alpha3: "US"))
    absent(AppUpdateInstallation.country(alpha3: ""))
  }
  func testAppTransactionMustBelongToThisDevice() {
    let nonce = UUID(), device = UUID()
    let digest = Data(SHA384.hash(data: Data((nonce.uuidString.lowercased() + device.uuidString.lowercased()).utf8)))
    truth(AppUpdateInstallation.belongsToDevice(nonce: nonce, device: device, digest: digest))
    falsity(AppUpdateInstallation.belongsToDevice(nonce: nonce, device: UUID(), digest: digest))
    falsity(AppUpdateInstallation.belongsToDevice(nonce: nonce, device: nil, digest: digest))
    falsity(AppUpdateInstallation.belongsToDevice(nonce: UUID(), device: device, digest: digest))
  }
  func testHandoffDeduplicatesAndRequiresRealReturn() {
    let state = AppUpdateHandoffState()
    falsity(state.finish(requireReturn: true))
    truth(state.begin())
    let first = state.generation
    falsity(state.begin())
    falsity(state.finish(requireReturn: true))
    state.leave()
    state.leave()
    truth(state.finish(requireReturn: true))
    falsity(state.finish(requireReturn: true))
    truth(state.begin())
    truth(state.generation != first)
    truth(state.finish()) // failed launch, no leave required
    falsity(state.finish())
  }
}
let tests = AppUpdateInstallationTests()
tests.testStorefrontMappingDoesNotUsePhoneLocale()
tests.testAppTransactionMustBelongToThisDevice()
tests.testHandoffDeduplicatesAndRequiresRealReturn()
print("3 native update test groups PASS")
