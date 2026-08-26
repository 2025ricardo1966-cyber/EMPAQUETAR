import type {
  CustomerProfile,
  OrderNotificationEvent,
} from '../../contracts/customer-experience';
import type { OrderAttachmentRef } from '../../contracts/order-domain';

export interface CustomerFileRecord extends OrderAttachmentRef {
  tenantId: string;
  customerId: string;
  orderId?: string;
  staged: boolean;
}

export interface CustomerStore {
  saveCustomer(profile: CustomerProfile): Promise<void>;
  getCustomer(customerId: string): Promise<CustomerProfile | undefined>;
  getCustomerByLogin(tenantId: string, login: string): Promise<CustomerProfile | undefined>;
  saveFileMeta(record: CustomerFileRecord): Promise<void>;
  getFile(fileId: string): Promise<CustomerFileRecord | undefined>;
  listFiles(fileIds: string[]): Promise<CustomerFileRecord[]>;
  writeBlob(fileId: string, bytes: Buffer): Promise<string>;
  readBlob?(fileId: string): Promise<Buffer | undefined>;
  appendEvent(event: OrderNotificationEvent): Promise<void>;
  listEvents(orderId: string): Promise<OrderNotificationEvent[]>;
}
