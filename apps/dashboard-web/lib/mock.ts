/**
 * بيانات وهمية للعرض فقط. بتنشال لما تجهز نقاط الباك اند (S0-08 وبعدها).
 * ولا سطر من هون بيوصل الإنتاج.
 */

export const DEMO_CREDENTIALS = {
  user: "manager@shawarma.jo",
  pass: "sufria1234",
} as const;

export const STAFF = { name: "أحمد درويش", role: "مدير الفرع" } as const;
export const RESTAURANT = {
  name: "شاورما الأصيل",
  branch: "فرع الشميساني",
} as const;

export type OrderStatus =
  "pending_acceptance" | "preparing" | "ready" | "expired";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_acceptance: "بانتظار القبول",
  preparing: "قيد التحضير",
  ready: "جاهز للاستلام",
  expired: "منتهي",
};

export type OrderItem = { name: string; qty: number; price: number };

export type Order = {
  id: string;
  code: string;
  customer: string;
  phone: string;
  status: OrderStatus;
  fulfillment: "استلام" | "توصيل";
  payment: "نقدا" | "إلكتروني";
  minutesAgo: number;
  items: OrderItem[];
  vip?: boolean;
  repeat?: boolean;
};

export const ORDERS: Order[] = [
  {
    id: "1",
    code: "047",
    customer: "رامي خالد",
    phone: "0790 112 884",
    status: "pending_acceptance",
    fulfillment: "استلام",
    payment: "نقدا",
    minutesAgo: 2,
    repeat: true,
    items: [
      { name: "شاورما دجاج عربي", qty: 2, price: 2.5 },
      { name: "بطاطا مقلية وسط", qty: 1, price: 1.25 },
      { name: "عيران", qty: 2, price: 0.75 },
    ],
  },
  {
    id: "2",
    code: "046",
    customer: "سُهى نصّار",
    phone: "0788 940 217",
    status: "pending_acceptance",
    fulfillment: "توصيل",
    payment: "إلكتروني",
    minutesAgo: 6,
    vip: true,
    items: [
      { name: "صحن شاورما لحمة", qty: 1, price: 5.75 },
      { name: "حمص بالصنوبر", qty: 1, price: 2.0 },
    ],
  },
  {
    id: "3",
    code: "045",
    customer: "مروان عبد الله",
    phone: "0777 651 309",
    status: "preparing",
    fulfillment: "استلام",
    payment: "نقدا",
    minutesAgo: 11,
    items: [
      { name: "شاورما دجاج عربي", qty: 4, price: 2.5 },
      { name: "سلطة ملفوف", qty: 2, price: 1.0 },
    ],
  },
  {
    id: "4",
    code: "044",
    customer: "لينا حدّاد",
    phone: "0795 300 448",
    status: "preparing",
    fulfillment: "توصيل",
    payment: "إلكتروني",
    minutesAgo: 18,
    repeat: true,
    items: [
      { name: "وجبة عائلية مشكّلة", qty: 1, price: 14.0 },
      { name: "عصير ليمون بالنعناع", qty: 3, price: 1.5 },
    ],
  },
  {
    id: "5",
    code: "043",
    customer: "زيد أبو رمّان",
    phone: "0791 887 026",
    status: "ready",
    fulfillment: "استلام",
    payment: "نقدا",
    minutesAgo: 24,
    items: [
      { name: "شاورما لحمة عربي", qty: 3, price: 3.0 },
      { name: "بطاطا مقلية كبير", qty: 1, price: 1.75 },
    ],
  },
  {
    id: "6",
    code: "042",
    customer: "هبة القيسي",
    phone: "0796 214 573",
    status: "expired",
    fulfillment: "توصيل",
    payment: "إلكتروني",
    minutesAgo: 71,
    items: [{ name: "صحن فتّة شاورما", qty: 2, price: 6.25 }],
  },
];

export const orderTotal = (o: Order): number =>
  o.items.reduce((sum, i) => sum + i.qty * i.price, 0);

export const money = (n: number): string =>
  n.toLocaleString("en-JO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
