import { ApiError, apiUrl, expireSession } from './api.js';

async function call(path, options = {}) {
  let res;
  try {
    res = await fetch(apiUrl(path), {
      ...options,
      credentials: 'include',
      headers: { Accept: 'application/json', ...(options.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Cannot reach the MediSync server.', { code: 'offline' });
  }
  if (res.status === 401) {
    expireSession();
    throw new ApiError('Your session expired. Please sign in again.', { status: 401 });
  }
  if (!res.ok) throw new ApiError('Could not load notifications.', { status: res.status });
  return res.json().catch(() => ({}));
}

export async function fetchNotifications() {
  const data = await call('/api/notifications');
  return {
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
    unread: Number(data.unread ?? 0),
  };
}

export const sendBackendAlert = ({ type = 'medication_reminder', title, body }) =>
  call('/api/notifications/alert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, title, body }),
  });

export const markNotificationRead = (id) =>
  call(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });

export const markAllNotificationsRead = () => call('/api/notifications/read-all', { method: 'POST' });
export const syncReminderSchedules = (schedules) =>
  call('/api/notifications/schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schedules }),
  });