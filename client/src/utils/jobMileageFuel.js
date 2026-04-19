/** Ordered fuel gauge levels (⅛ steps). Stored as these strings on jobs / test drives. */
export const FUEL_LEVEL_OPTIONS = ['Empty', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8', 'Full'];

const FUEL_LEVEL_FRAC = {
  Empty: 0,
  '1/8': 1 / 8,
  '1/4': 2 / 8,
  '3/8': 3 / 8,
  '1/2': 4 / 8,
  '5/8': 5 / 8,
  '3/4': 6 / 8,
  '7/8': 7 / 8,
  Full: 1,
};

function fuelLevelToFrac(level) {
  if (level == null || level === '') return null;
  const f = FUEL_LEVEL_FRAC[level];
  return f === undefined ? null : f;
}

function formatTankFrac(frac) {
  const q = Math.round(frac * 8) / 8;
  if (q <= 0) return 'minimal';
  if (q >= 1) return '1';
  const eighthUnicode = {
    0.125: '⅛',
    0.25: '¼',
    0.375: '⅜',
    0.5: '½',
    0.625: '⅝',
    0.75: '¾',
    0.875: '⅞',
  };
  if (eighthUnicode[q] != null) return eighthUnicode[q];
  return `${Math.round(frac * 100)}%`;
}

function describeFuelUsed(prevLevel, currLevel) {
  const a = fuelLevelToFrac(prevLevel);
  const b = fuelLevelToFrac(currLevel);
  if (a === null || b === null) return '—';
  const used = a - b;
  const usedE = Math.round(used * 8) / 8;
  if (Math.abs(usedE) < 0.0625) return '—';
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
