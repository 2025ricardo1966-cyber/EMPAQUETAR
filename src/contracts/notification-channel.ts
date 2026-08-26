/**
 * Event → Notification → Channel.
 * In-app is the only required channel in this phase. Email is optional (existing EmailService).
 */
export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type DomainNotificationEvent =
  | 'CLIENT_MESSAGE_CREATED'
  | 'CLIENT_MESSAGE_REPLIED'
  | 'ADMIN_MESSAGE_REPLIED'
  | 'MESSAGE_STATUS_CHANGED'
  | 'COMMERCIAL_CONFIG_UPDATED';

export function defaultChannelsFor(_event: DomainNotificationEvent): NotificationChannel[] {
  return ['IN_APP'];
}
