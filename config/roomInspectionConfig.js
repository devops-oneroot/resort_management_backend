/**
 * Room categories and numbering for daily inspections.
 * - Aqua Room: physical numbers 14–33
 * - Heritage Cottage: 220–237
 * - Suite Room: S1–S10 (stored roomNumber 1–10 for stable sorting / unique index)
 * - Campaign Room: 1–12
 * - Suite Room with Pool: 4 rooms (1–4), unchanged from original setup
 */
const ROOM_CATEGORIES = [
  { key: 'aqua_room', name: 'Aqua Room', totalRooms: 20, roomNumberStart: 14 },
  { key: 'suite_room', name: 'Suite Room', totalRooms: 10, roomNumberKind: 'suite_suffix' },
  { key: 'heritage_room', name: 'Heritage Cottage', totalRooms: 18, roomNumberStart: 220 },
  { key: 'campaign_room', name: 'Campaign Room', totalRooms: 12, roomNumberStart: 1 },
  { key: 'suite_room_with_pool', name: 'Suite Room with Pool', totalRooms: 4 },
];

const AQUA_CHECKLIST_ITEMS = [
  'Key',
  'Hanger',
  'Table',
  'Dustbin',
  'Phone',
  'A/C',
  'Chair',
  'Bucket',
  'Mug',
  'Cupboard',
  'Mirror',
];

const STANDARD_CHECKLIST_ITEMS = [
  'Key',
  'Hanger',
  'Table',
  'Dustbin',
  'Tea Table',
  'Phone',
  'TV',
  'TV Remote',
  'A/C',
  'A/C Remote',
  'STB Box',
  'STB Remote',
  'Chair',
  'Bucket',
  'Mug',
  'Window Curtain',
  'Cupboard',
  'Fan',
  'Mirror',
  'Exhaust Fan',
];

function getChecklistForCategory(categoryName) {
  const lower = String(categoryName || '').toLowerCase();
  if (lower === 'aqua room') {
    return AQUA_CHECKLIST_ITEMS;
  }
  return STANDARD_CHECKLIST_ITEMS;
}

/**
 * @param {typeof ROOM_CATEGORIES[number]} category
 * @returns {{ roomNumber: number, roomLabel: string }[]}
 */
function getSeedSlotsForCategory(category) {
  const n = category.totalRooms;
  if (category.roomNumberKind === 'suite_suffix') {
    return Array.from({ length: n }, (_, i) => ({
      roomNumber: i + 1,
      roomLabel: `${category.name} S${i + 1}`,
    }));
  }
  const start = category.roomNumberStart ?? 1;
  return Array.from({ length: n }, (_, i) => {
    const num = start + i;
    return { roomNumber: num, roomLabel: `${category.name} ${num}` };
  });
}

function buildRoomLabel(categoryName, roomNumber) {
  return `${categoryName} ${roomNumber}`;
}

module.exports = {
  ROOM_CATEGORIES,
  AQUA_CHECKLIST_ITEMS,
  STANDARD_CHECKLIST_ITEMS,
  getChecklistForCategory,
  getSeedSlotsForCategory,
  buildRoomLabel,
};
