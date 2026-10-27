import React, { useState, useEffect } from 'react';
import { subscribeSyncState, triggerSync, getNetworkState } from '../offline/syncEngine';
import { getSyncQueue } from '../offline/offlineDb';

export default function SyncStatusBar({ userId, userName, showToast }) {
  const [isOnline, setIsOnline] = useState(getNetworkState());
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [queueItems, setQueueItems] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);

  const refreshQueue = async () => {
    if (!userId) return;
    try {
      const items = await getSyncQueue(userId);
      setQueueItems(items);
      const waiting = items.filter((m) => m.status === 'waiting' || m.status === 'syncing').length;
      const failed = items.filter((m) => m.status === 'failed').length;
      setPendingCount(waiting);
      setFailedCount(failed);
    } catch {}
  };

  useEffect(() => {
    refreshQueue();
    const unsubscribe = subscribeSyncState((state) => {
      if (state.isOnline !== undefined) setIsOnline(state.isOnline);
      if (state.isSyncing !== undefined) setIsSyncing(state.isSyncing);
      if (state.pendingCount !== undefined) setPendingCount(state.pendingCount);
      if (state.failedCount !== undefined) setFailedCount(state.failedCount);
      if (state.queue) setQueueItems(state.queue);
      else refreshQueue();
    });

    return () => unsubscribe();
  }, [userId]);

  const handleManualSync = async () => {
    if (!userId) return;
    if (!navigator.onLine) {
      if (showToast) showToast('Device is offline. Connect to internet to sync.');
      return;
    }
    if (showToast) showToast('Syncing pending changes with cloud...');
    await triggerSync(userId);
    refreshQueue();
  };

  return (
    <>
      <div className="sync-status-bar" style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 10px',
        fontSize: '12px',
        borderRadius: '20px',
        background: isOnline ? 'rgba(46, 125, 50, 0.08)' : 'rgba(237, 108, 2, 0.12)',
        border: `1px solid ${isOnline ? 'rgba(46, 125, 50, 0.25)' : 'rgba(237, 108, 2, 0.35)'}`,
        cursor: 'pointer',
        userSelect: 'none'
      }}
      onClick={() => {
        refreshQueue();
        setModalOpen(true);
      }}
      title="Click to view offline sync queue"
      >
        {/* Network Dot */}
        <span style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: isOnline ? '#2e7d32' : '#ed6c02',
          boxShadow: isOnline ? '0 0 6px rgba(46, 125, 50, 0.6)' : '0 0 6px rgba(237, 108, 2, 0.6)'
        }} />

        <span style={{ fontWeight: 600, color: isOnline ? '#1b5e20' : '#b25e00' }}>
          {isOnline ? 'Online' : 'Offline'}
        </span>

        {/* Sync Status Badge */}
        {isSyncing ? (
          <span style={{ color: '#0288d1', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="sync-spinner">🔄</span> Syncing...
          </span>
        ) : failedCount > 0 ? (
          <span style={{
            background: '#d32f2f',
            color: '#fff',
            padding: '1px 6px',
            borderRadius: '10px',
            fontSize: '11px',
            fontWeight: 700
          }}>
            {failedCount} Needs attention
          </span>
        ) : pendingCount > 0 ? (
          <span style={{
            background: '#ed6c02',
            color: '#fff',
            padding: '1px 6px',
            borderRadius: '10px',
            fontSize: '11px',
            fontWeight: 700
          }}>
            {pendingCount} Waiting to sync
          </span>
        ) : (
          <span style={{ color: '#2e7d32', fontSize: '11px' }}>
            ✓ Synced
          </span>
        )}
      </div>

      {/* Sync Queue Modal */}
      {modalOpen && (
        <div className="modal-backdrop" style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div className="modal-card" style={{
            background: '#fff',
            borderRadius: '12px',
            maxWidth: '540px',
            width: '100%',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
            overflow: 'hidden'
          }}>
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #e0e0e0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8fafc'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                  Offline Sync Queue
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                  User: {userName || `Agent #${userId}`} • {isOnline ? '🟢 Connected to cloud' : '🟠 Offline Mode'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: '#64748b'
                }}
              >
                ✕
              </button>
            </div>

            {/* Pilot Security Banner */}
            <div style={{
              padding: '10px 16px',
              background: '#fffbeb',
              borderBottom: '1px solid #fef3c7',
              fontSize: '11px',
              color: '#92400e',
              lineHeight: 1.4
            }}>
              ⚠️ <strong>Pilot Security Notice:</strong> Cached data is stored in the app sandbox on this device and gated by biometric unlock. Local data is not encrypted at rest and can be exposed if the device is rooted or compromised.
            </div>

            {/* Body: Queue items */}
            <div style={{
              padding: '16px 20px',
              overflowY: 'auto',
              flex: 1
            }}>
              {queueItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 10px', color: '#64748b' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>✅</div>
                  <p style={{ margin: 0, fontWeight: 600 }}>No changes waiting to sync.</p>
                  <p style={{ margin: '4px 0 0', fontSize: '12px' }}>
                    All orders and delivery status updates have been safely received by the cloud server.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {queueItems.map((item) => {
                    const isOrder = item.type === 'CREATE_ORDER';
                    const isDel = item.type === 'UPDATE_DELIVERY_STATUS';
                    const status = item.status;

                    let badgeColor = '#ed6c02';
                    let badgeBg = '#fff7ed';
                    let badgeText = 'Waiting to sync';

                    if (status === 'syncing') {
                      badgeColor = '#0288d1';
                      badgeBg = '#e1f5fe';
                      badgeText = 'Syncing...';
                    } else if (status === 'synced') {
                      badgeColor = '#2e7d32';
                      badgeBg = '#e8f5e9';
                      badgeText = item.syncedResult?.orderId ? `Synced (${item.syncedResult.orderId})` : 'Synced';
                    } else if (status === 'failed') {
                      badgeColor = '#d32f2f';
                      badgeBg = '#ffebee';
                      badgeText = 'Needs attention';
                    }

                    return (
                      <div
                        key={item.mutationId}
                        style={{
                          border: `1px solid ${status === 'failed' ? '#fca5a5' : '#e2e8f0'}`,
                          borderRadius: '8px',
                          padding: '12px',
                          background: status === 'failed' ? '#fff5f5' : '#ffffff',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700, fontSize: '13px', color: '#1e293b' }}>
                            {isOrder ? `📦 New Order (${item.payload.tempRef})` : `🚚 Delivery Update`}
                          </span>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: badgeColor,
                            background: badgeBg,
                            padding: '2px 8px',
                            borderRadius: '12px',
                            border: `1px solid ${badgeColor}33`
                          }}>
                            {badgeText}
                          </span>
                        </div>

                        {/* Details */}
                        <div style={{ fontSize: '12px', color: '#475569' }}>
                          {isOrder && (
                            <div>
                              <strong>{item.payload.shopName}</strong> • {item.payload.itemsCount} items • ₹{Number(item.payload.total).toLocaleString('en-IN')}
                            </div>
                          )}
                          {isDel && (
                            <div>
                              Order <strong>{item.payload.orderId}</strong> ➔ New status: <strong>{item.payload.status}</strong>
                              {item.payload.reason && <span> (Reason: {item.payload.reason})</span>}
                            </div>
                          )}
                          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                            Device time: {new Date(item.deviceEventTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} • Idempotency key: {item.idempotencyKey.slice(0, 16)}...
                          </div>
                        </div>

                        {/* Error info if failed */}
                        {item.syncError && (
                          <div style={{
                            fontSize: '11px',
                            color: '#b91c1c',
                            background: '#fee2e2',
                            padding: '6px 8px',
                            borderRadius: '4px',
                            marginTop: '4px'
                          }}>
                            <strong>Sync notice:</strong> {item.syncError}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid #e0e0e0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8fafc'
            }}>
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                Independent queue: Failures do not block other items.
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ padding: '6px 14px', fontSize: '13px' }}
                  onClick={() => setModalOpen(false)}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="primary-button"
                  style={{ padding: '6px 16px', fontSize: '13px' }}
                  disabled={isSyncing || !isOnline || queueItems.length === 0}
                  onClick={handleManualSync}
                >
                  {isSyncing ? 'Syncing...' : 'Sync Now 🔄'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
