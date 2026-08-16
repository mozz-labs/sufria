/**
 * أنواع النطاق المشتركة. الفرونت اند بيستوردها زي الباك اند بالضبط،
 * فلو حدا غيّر حالة طلب بالباك اند وما عدّل الواجهة، الـtypecheck بيوقع.
 */

export const ORDER_STATUSES = [
  'pending_acceptance', 'accepted', 'preparing', 'ready',
  'completed', 'cancelled', 'expired',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'pending_cash', 'pending_online', 'paid', 'collected', 'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** النصوص العربية المعتمدة. DESIGN.md §4 — لا تُكتب inline بأي مكان تاني. */
export const ORDER_STATUS_LABEL_AR: Record<OrderStatus, string> = {
  pending_acceptance: 'بانتظار القبول',
  accepted: 'تم القبول',
  preparing: 'قيد التحضير',
  ready: 'جاهز للاستلام',
  completed: 'مكتمل',
  cancelled: 'ملغى',
  expired: 'انتهت الصلاحية',
};

/**
 * الانتقالات المسموحة. مصدر الحقيقة الوحيد — الباك اند بيتحقق منها
 * والفرونت اند بيعطّل الأزرار حسبها. FR-13.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_acceptance: ['accepted', 'cancelled'],
  accepted:           ['preparing', 'cancelled'],
  preparing:          ['ready', 'completed', 'cancelled'],
  ready:              ['completed', 'cancelled', 'expired'],
  completed:          [],
  cancelled:          [],
  expired:            [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * بوابة القبول — FR-13 / مخطط 6.4 جزء أ.
 * طلب أونلاين ما بينقبل قبل تأكيد الدفع. الإجراء الوحيد المتاح قبلها: الإلغاء.
 */
export function canAcceptOrder(o: { paymentMethod: 'online' | 'cash'; paymentStatus: PaymentStatus }): boolean {
  return o.paymentMethod !== 'online' || o.paymentStatus === 'paid';
}

export const CANNOT_ACCEPT_REASON_AR = 'لا يمكن قبول الطلب قبل تأكيد الدفع';
