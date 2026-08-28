import React, { useEffect, useState } from 'react';
import { downloadBase64File } from '../../foundation/download';
import { apiNoticeKey } from '../../foundation/api-notice';
import { useAuth } from '../providers/AuthProvider';
import { useI18n } from '../providers/I18nProvider';

type FileRow = { id?: string; filename?: string; mimeType?: string; status?: string; sizeBytes?: number };
type TimelineRow = { eventId?: string; eventType?: string; title?: string; displayAt?: string; actorLabel?: string };
type OutputRow = { id?: string; filename?: string; format?: string; mimeType?: string };

export const OrderOpsPanel: React.FC<{
  orderId: string;
  customerName?: string;
  files?: FileRow[];
  outputs?: OutputRow[];
  fileBase: 'workspace' | 'client';
}> = ({ orderId, customerName, files: initialFiles, outputs: initialOutputs, fileBase }) => {
  const { t } = useI18n();
  const { api } = useAuth();
  const [files, setFiles] = useState<FileRow[]>(initialFiles || []);
  const [outputs, setOutputs] = useState<OutputRow[]>(initialOutputs || []);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setFiles(initialFiles || []);
    setOutputs(initialOutputs || []);
  }, [initialFiles, initialOutputs]);

  useEffect(() => {
    const prefix = fileBase === 'workspace' ? `/workspace/orders/${orderId}` : `/client/orders/${orderId}`;
    void api
      .get(`${prefix}/timeline`)
      .then((res) => setTimeline(Array.isArray(res.data) ? (res.data as TimelineRow[]) : []))
      .catch(() => undefined);
    if (fileBase === 'workspace') {
      void api
        .get(`${prefix}/files`)
        .then((res) => setFiles(Array.isArray(res.data) ? (res.data as FileRow[]) : []))
        .catch(() => undefined);
    }
  }, [api, fileBase, orderId]);

  const download = (fileId: string) => {
    const path =
      fileBase === 'workspace'
        ? `/workspace/orders/${orderId}/files/${fileId}`
        : `/client/orders/${orderId}/files/${fileId}`;
    void api
      .get(path)
      .then((res) => {
        const data = res.data as { filename?: string; mimeType?: string; contentBase64?: string };
        if (!data.contentBase64) return;
        downloadBase64File(data.filename || 'archivo', data.mimeType || 'application/octet-stream', data.contentBase64);
      })
      .catch((err) => setNotice(t(apiNoticeKey(err))));
  };

  const industrial = files.filter((f) => {
    const name = String(f.filename || '').toLowerCase();
    return name.endsWith('.json') || name.endsWith('.svg') || name.endsWith('.dxf') || name.endsWith('.pdf') || f.status === 'VALIDATED';
  });

  return (
    <div data-role="order-ops">
      {customerName ? (
        <p>
          {t('ops.customer')}: {customerName}
        </p>
      ) : null}
      <h3>{t('ops.outputs')}</h3>
      <ul>
        {(outputs.length ? outputs : industrial).map((row) => {
          const id = row.id || '';
          return (
            <li key={id || row.filename}>
              {row.filename} {'format' in row ? row.format || '' : ''}
              {id ? (
                <button type="button" onClick={() => download(id)}>
                  {t('ops.download')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <h3>{t('ops.files')}</h3>
      <ul>
        {files.map((f) => (
          <li key={f.id || f.filename}>
            {f.filename} {f.status} {f.sizeBytes || ''}
            {f.id ? (
              <button type="button" onClick={() => download(f.id!)}>
                {t('ops.download')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <h3>{t('ops.trace')}</h3>
      <ul>
        {timeline.map((ev) => (
          <li key={ev.eventId || `${ev.eventType}-${ev.displayAt}`}>
            {ev.displayAt} {ev.title || ev.eventType} {ev.actorLabel || ''}
          </li>
        ))}
      </ul>
      {notice ? <p>{notice}</p> : null}
    </div>
  );
};
