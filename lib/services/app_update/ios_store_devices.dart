/// Exact bindings from Apple's Xcode 26.5 `simctl list devicetypes -j`
/// (modelIdentifier + name), matched to Apple's public software lookup tokens
/// on 2026-10-14. Only whitespace/case-equivalent names were bound; no family,
/// prefix, generation or OS-support inference. Public Pages listing was used
/// to verify token format, never as evidence of BiteStar identity/availability.
/// Eligibility still requires the token in BiteStar's OWN current listing.
/// Unknown/new/unmapped models fail open. Extend only with verified Apple data.
const iosStoreDeviceTokens = <String, String>{
  'iPhone18,1': 'iPhone17Pro-iPhone17Pro', // iPhone 17 Pro
  'iPhone18,2': 'iPhone17ProMax-iPhone17ProMax', // iPhone 17 Pro Max
  'iPhone18,5': 'iPhone17e-iPhone17e', // iPhone 17e
  'iPhone18,4': 'iPhoneAir-iPhoneAir', // iPhone Air
  'iPhone18,3': 'iPhone17-iPhone17', // iPhone 17
  'iPhone17,1': 'iPhone16Pro-iPhone16Pro', // iPhone 16 Pro
  'iPhone17,2': 'iPhone16ProMax-iPhone16ProMax', // iPhone 16 Pro Max
  'iPhone17,5': 'iPhone16e-iPhone16e', // iPhone 16e
  'iPhone17,3': 'iPhone16-iPhone16', // iPhone 16
  'iPhone17,4': 'iPhone16Plus-iPhone16Plus', // iPhone 16 Plus
  'iPhone16,1': 'iPhone15Pro-iPhone15Pro', // iPhone 15 Pro
  'iPhone16,2': 'iPhone15ProMax-iPhone15ProMax', // iPhone 15 Pro Max
  'iPhone15,4': 'iPhone15-iPhone15', // iPhone 15
  'iPhone15,5': 'iPhone15Plus-iPhone15Plus', // iPhone 15 Plus
  'iPhone15,2': 'iPhone14Pro-iPhone14Pro', // iPhone 14 Pro
  'iPhone15,3': 'iPhone14ProMax-iPhone14ProMax', // iPhone 14 Pro Max
  'iPhone14,7': 'iPhone14-iPhone14', // iPhone 14
  'iPhone14,8': 'iPhone14Plus-iPhone14Plus', // iPhone 14 Plus
  'iPhone14,2': 'iPhone13Pro-iPhone13Pro', // iPhone 13 Pro
  'iPhone14,3': 'iPhone13ProMax-iPhone13ProMax', // iPhone 13 Pro Max
  'iPhone14,5': 'iPhone13-iPhone13', // iPhone 13
  'iPhone14,4': 'iPhone13Mini-iPhone13Mini', // iPhone 13 mini
  'iPhone13,3': 'iPhone12Pro-iPhone12Pro', // iPhone 12 Pro
  'iPhone13,4': 'iPhone12ProMax-iPhone12ProMax', // iPhone 12 Pro Max
  'iPhone13,2': 'iPhone12-iPhone12', // iPhone 12
  'iPhone13,1': 'iPhone12Mini-iPhone12Mini', // iPhone 12 mini
  'iPhone12,3': 'iPhone11Pro-iPhone11Pro', // iPhone 11 Pro
  'iPhone12,5': 'iPhone11ProMax-iPhone11ProMax', // iPhone 11 Pro Max
  'iPhone12,1': 'iPhone11-iPhone11', // iPhone 11
  'iPhone11,2': 'iPhoneXS-iPhoneXS', // iPhone Xs
  'iPhone11,4': 'iPhoneXSMax-iPhoneXSMax', // iPhone Xs Max
  'iPhone10,6': 'iPhoneX-iPhoneX', // iPhone X
  'iPhone10,4': 'iPhone8-iPhone8', // iPhone 8
  'iPhone10,5': 'iPhone8Plus-iPhone8Plus', // iPhone 8 Plus
  'iPhone9,1': 'iPhone7-iPhone7', // iPhone 7
  'iPhone9,2': 'iPhone7Plus-iPhone7Plus', // iPhone 7 Plus
  'iPhone8,1': 'iPhone6s-iPhone6s', // iPhone 6s
  'iPhone8,2': 'iPhone6sPlus-iPhone6sPlus', // iPhone 6s Plus
  'iPad5,4': 'iPadAir2-iPadAir2', // iPad Air 2
  'iPad5,1': 'iPadMini4-iPadMini4', // iPad mini 4
};
