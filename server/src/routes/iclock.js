import { Router } from 'express';
import { recordAttendanceEvent } from '../services/attendanceService.js';
import { parseKenyaLocalDateTime } from '../utils/kenyaTime.js';
import {
  getClockedInAdminUserIds,
  resolveAdminUserIdFromDevicePin,
  resolveEventTypeForPin,
} from '../services/zktecoPinMap.js';

const router = Router();

function buildOptionsResponse(serialNumber) {
  const stamp = '1970-01-01T00:00:00';
  return [
    `GET OPTION FROM: ${serialNumber}`,
    'ErrorDelay=60',
    'Delay=30',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=111111111111',
    'Realtime=1',
    'Encrypt=0',
    'TimeZone=3',
    'Timeout=60',
    'SyncTime=3600',
    'ServerVer=3.0.1',
    'PushProtVer=2.4.1',
    `ATTLOGStamp=${stamp}`,
    `OPERLOGStamp=${stamp}`,
    `ATTPHOTOStamp=${stamp}`,
    `BIODATAStamp=${stamp}`,
  ].join('\n');
}

function parseAttlogLine(line) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.includes('\t') ? trimmed.split('\t') : trimmed.split(/\s+/);
  if (parts.length < 2) {
    return null;
  }

  const pin = parts[0];
  const dateTime = parts[1].includes('T') ? parts[1].replace('T', ' ') : parts[1];
  const statusCode = parts[2] ?? '0';

  let occurredAt;
  try {
    occurredAt = parseKenyaLocalDateTime(dateTime);
  } catch {
    return null;
  }

  return {
    pin,
    occurredAt,
    statusCode,
  };
}

function handleRegistry(req, res) {
  const serialNumber = req.query.SN ?? 'UNKNOWN';
  console.log(`[ZKTECO] registry ${req.method} SN=${serialNumber}`);
  res.type('text/plain').send(`RegistryCode=OK\nSN=${serialNumber}`);
}

router.get('/registry', handleRegistry);
router.post('/registry', handleRegistry);

router.get('/cdata', (req, res) => {
  const serialNumber = req.query.SN ?? 'UNKNOWN';
  console.log(
    `[ZKTECO] GET /cdata SN=${serialNumber} options=${req.query.options ?? ''} table=${req.query.table ?? ''}`,
  );
  if (req.query.options === 'all') {
    res.type('text/plain').send(buildOptionsResponse(serialNumber));
    return;
  }
  res.type('text/plain').send('OK');
});

router.post('/cdata', (req, res) => {
  const serialNumber = req.query.SN ?? 'UNKNOWN';
  const table = req.query.table;
  const body = typeof req.body === 'string' ? req.body : '';

  console.log(
    `[ZKTECO] POST /cdata SN=${serialNumber} table=${table ?? ''} bytes=${body.length} body=${body.slice(0, 200)}`,
  );

  if (table !== 'ATTLOG') {
    res.type('text/plain').send('OK');
    return;
  }

  const lines = body.split(/\r?\n/).filter(Boolean);

  try {
    const activeClockedInIds = getClockedInAdminUserIds();

    for (const line of lines) {
      const parsed = parseAttlogLine(line);
      if (!parsed) {
        console.warn('Skipped unparsable ATTLOG line:', line);
        continue;
      }

      const adminUserId = resolveAdminUserIdFromDevicePin(parsed.pin);
      if (!adminUserId) {
        console.warn(`No team member match for device PIN ${parsed.pin}`);
        continue;
      }

      const eventType = resolveEventTypeForPin(parsed.pin, parsed.statusCode, activeClockedInIds);

      recordAttendanceEvent({
        adminUserId,
        eventType,
        occurredAt: parsed.occurredAt.toISOString(),
        deviceId: `zkteco:${serialNumber}`,
        sourceEventId: `zk-${serialNumber}-${parsed.pin}-${parsed.occurredAt.toISOString()}-${parsed.statusCode}`,
      });

      if (eventType === 'clock_in' && !activeClockedInIds.includes(adminUserId)) {
        activeClockedInIds.push(adminUserId);
      }
      if (eventType === 'clock_out') {
        const index = activeClockedInIds.indexOf(adminUserId);
        if (index >= 0) {
          activeClockedInIds.splice(index, 1);
        }
      }

      console.log(
        `ATTLOG ${serialNumber}: PIN ${parsed.pin} -> admin #${adminUserId} ${eventType} @ ${parsed.occurredAt.toISOString()}`,
      );
    }

    res.type('text/plain').send('OK');
  } catch (error) {
    console.error('POST /iclock/cdata failed:', error);
    res.type('text/plain').status(500).send('ERROR');
  }
});

router.get('/getrequest', (req, res) => {
  console.log(`[ZKTECO] GET /getrequest SN=${req.query.SN ?? 'UNKNOWN'}`);
  res.type('text/plain').send('OK');
});

router.post('/devicecmd', (_req, res) => {
  res.type('text/plain').send('OK');
});

export const iclockRouter = router;
