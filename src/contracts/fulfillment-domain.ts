export type FulfillmentMode = 'PICKUP' | 'DELIVERY';

export interface PartyRef {
  name: string;
  customerId?: string;
  userId?: string;
  phone?: string;
  notes?: string;
}

export interface DeliveryDestination {
  name: string;
  company?: string;
  country: string;
  region?: string;
  city: string;
  postalCode?: string;
  address: string;
  phone?: string;
  instructions?: string;
}

export interface OrderFulfillment {
  mode: FulfillmentMode;
  /** Snapshot of tenant capabilities at creation time does not apply; mode is immutable for history. */
  commercialAccountId?: string;
  requester?: PartyRef;
  payer?: PartyRef;
  destination?: DeliveryDestination;
  recipient?: PartyRef;
  pickupAuthorized?: PartyRef;
  exceptionMessageId?: string;
  exceptionApproved?: boolean;
}

export interface ClientFulfillmentOptions {
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  pickupByThirdPartyEnabled: boolean;
}

export const DEFAULT_CLIENT_OPTIONS: ClientFulfillmentOptions = {
  pickupEnabled: true,
  deliveryEnabled: false,
  pickupByThirdPartyEnabled: false,
};

export function normalizeClientOptions(raw?: Partial<ClientFulfillmentOptions> | null): ClientFulfillmentOptions {
  return {
    pickupEnabled: raw?.pickupEnabled !== false,
    deliveryEnabled: raw?.deliveryEnabled === true,
    pickupByThirdPartyEnabled: raw?.pickupByThirdPartyEnabled === true,
  };
}
