import {
  executeCustomerBiteSaverDeviceBoundUse,
  parseCustomerBiteSaverCombinedUseRequest,
  type CustomerBiteSaverDeviceUseContext,
  type CustomerBiteSaverDeviceUseResult,
} from "./customer_bitesaver_device_usage_core.js";
import {
  prepareCustomerBiteSaverSavedDeviceUseAuthority,
} from "./customer_bitesaver_saved.js";
import {
  prepareCustomerBiteSaverDiscoveryDeviceUseAuthority,
} from "./customer_bitesaver_search_session.js";

/**
 * Server-internal combined Use Coupon handler. Do not export this through
 * functions/src/index.ts until a production device-evidence verifier and the
 * corresponding native credential flow are connected.
 */
export async function handleCustomerBiteSaverDeviceBoundUse(
  rawRequest: unknown,
  context: CustomerBiteSaverDeviceUseContext,
): Promise<CustomerBiteSaverDeviceUseResult> {
  const request = parseCustomerBiteSaverCombinedUseRequest(rawRequest);
  return executeCustomerBiteSaverDeviceBoundUse(
    request,
    context,
    request.origin.kind === "discovery"
      ? prepareCustomerBiteSaverDiscoveryDeviceUseAuthority
      : prepareCustomerBiteSaverSavedDeviceUseAuthority,
  );
}
