/** بيانات اختبار العزل. للتطوير والـCI فقط — أبدا على الإنتاج. */
import { psql } from './psql.mjs';

if (process.env.NODE_ENV === 'production') {
  console.error('✗ رفض: seed ممنوع على الإنتاج');
  process.exit(1);
}
const r = psql({ file: 'db/seed/chain-isolation-fixture.sql', quiet: true });
process.exit(r.status === 0 ? (console.log('✓ بيانات الاختبار انزرعت'), 0) : 1);
