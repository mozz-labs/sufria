import EmptyState from "../../../components/EmptyState";

export default function SettingsPage() {
  return (
    <EmptyState
      icon="⚙"
      title="إعدادات المطعم"
      body="ساعات العمل، طرق الدفع المقبولة، ورقم واتساب المرتبط بالفرع."
      action="فتح الإعدادات"
    />
  );
}
