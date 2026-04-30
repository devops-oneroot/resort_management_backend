const ROOM_CATEGORIES = [
  { key: 'aqua_room', name: 'Aqua Room', totalRooms: 20 },
  { key: 'suite_room', name: 'Suite Room', totalRooms: 6 },
  { key: 'heritage_room', name: 'Heritage Room', totalRooms: 18 },
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
  if (String(categoryName).toLowerCase() === 'aqua room') {
    return AQUA_CHECKLIST_ITEMS;
  }
  return STANDARD_CHECKLIST_ITEMS;
}

function buildRoomLabel(categoryName, roomNumber) {
  return `${categoryName} ${roomNumber}`;
}

module.exports = {
  ROOM_CATEGORIES,
  AQUA_CHECKLIST_ITEMS,
  STANDARD_CHECKLIST_ITEMS,
  getChecklistForCategory,
  buildRoomLabel,
};
