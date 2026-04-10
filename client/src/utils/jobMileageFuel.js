const FUEL_LEVEL_FRAC = { Empty: 0, '1/4': 0.25, '1/2': 0.5, '3/4': 0.75, Full: 1 };

function fuelLevelToFrac(level) {
  if (level == null || level === '') return null;
  const f = FUEL_LEVEL_FRAC[level];
  return f === undefined ? null : f;
}

function formatTankFrac(frac) {
  const q = Math.round(frac * 4) / 4;
  if (q <= 0) return 'minimal';
  if (q === 0.25) return '¼';
  if (q === 0.5) return '½';
  if (q === 0.75) return '¾';
  if (q >= 1) return '1';
  return `${Math.round(frac * 100)}%`;
}

function describeFuelUsed(prevLevel, currLevel) {
  const a = fuelLevelToFrac(prevLevel);
  const b = fuelLevelToFrac(currLevel);
  if (a === null || b === null) return '—';
  const used = a - b;
  if (Math.abs(used) < 0.02) return '—';
  if (used < 0) return `≈ +${formatTankFrac(-used)} (gauge)`;
  return `≈ ${formatTankFrac(used)} tank`;
}

export function formatKmDelta(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString()} km`;
}

export function testDriveComputedRows(testDrives, odometerIn, fuelIn) {
  let prevOdo = odometerIn != null && odometerIn !== '' ? Number(odometerIn) : null;
  let prevFuel = fuelIn;
  return (testDrives || []).map((td, i) => {
    const odo = Number(td.odometer);
    const covered = prevOdo != null && Number.isFinite(odo) ? odo - prevOdo : null;
    const used = describeFuelUsed(prevFuel, td.fuel);
    prevOdo = odo;
    prevFuel = td.fuel;
    return { id: td.id, index: i, covered, used };
  });
}

export function handoverComputed(testDrives, odometerIn, fuelIn, odometerOut, fuelOut) {
  const lastOdo =
    testDrives?.length > 0
      ? Number(testDrives[testDrives.length - 1].odometer)
      : odometerIn != null && odometerIn !== ''
        ? Number(odometerIn)
        : null;
  const outOdo = odometerOut !== '' && odometerOut != null ? Number(odometerOut) : null;
  const mileageCovered =
    lastOdo != null && outOdo != null && Number.isFinite(lastOdo) && Number.isFinite(outOdo)
      ? outOdo - lastOdo
      : null;
  const prevFuel = testDrives?.length > 0 ? testDrives[testDrives.length - 1].fuel : fuelIn;
  const fuelUsed = describeFuelUsed(prevFuel, fuelOut);
  return { mileageCovered, fuelUsed };
}
