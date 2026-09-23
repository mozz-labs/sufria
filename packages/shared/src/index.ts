/**
 * كل شي مشترك بين الخدمتين والفرونت اند بيمر من هون.
 *
 * ليش الـmonorepo موجود أصلا: SRS §1.8.1 بتقول "shared TypeScript types
 * imported from the backend's type definitions". بريبوهات منفصلة هاد بيتطلب
 * نشر حزمة npm أو git submodule. بـpnpm workspace بيصير import عادي.
 */
export * from "./schema.js";
export * from "./domain.js";
export * from "./normalize.js";
export * from "./item-parser.js";
export * from "./dashboard-api.js";
