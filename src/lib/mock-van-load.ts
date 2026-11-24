export type VanDayStatus = "PREPARING" | "OPEN" | "CLOSED";

export type VanLoadProduct = {
  id: string;
  name: string;
  unit: string;
};

export type MockVanDay = {
  id: string;
  vanCode: string;
  driverName: string;
  businessDate: string;
  status: VanDayStatus;
  openingQuantities: Record<string, number>;
};

export const mockProducts = [
  { id: "water", name: "Water bottles", unit: "bottles" },
  { id: "juice", name: "Juice boxes", unit: "boxes" },
  { id: "milk", name: "Milk cartons", unit: "cartons" },
] satisfies VanLoadProduct[];

export const mockVanDays: MockVanDay[] = [
  {
    id: "van-day-04-2026-11-24",
    vanCode: "VAN-04",
    driverName: "Samir Haddad",
    businessDate: "2026-11-24",
    status: "PREPARING",
    openingQuantities: { water: 100, juice: 60, milk: 40 },
  },
  {
    id: "van-day-07-2026-11-24",
    vanCode: "VAN-07",
    driverName: "Maya Khoury",
    businessDate: "2026-11-24",
    status: "OPEN",
    openingQuantities: { water: 80, juice: 45, milk: 30 },
  },
  {
    id: "van-day-02-2026-11-23",
    vanCode: "VAN-02",
    driverName: "Karim Nasser",
    businessDate: "2026-11-23",
    status: "CLOSED",
    openingQuantities: { water: 120, juice: 70, milk: 50 },
  },
];
