"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { DASHBOARD_UI_AR, type MenuCategory } from "@sufria/shared";
import { menuApi } from "../api/menu-api.ts";
import { addDecision, menuErrorLine, type Draft } from "../lib/menu.ts";
import styles from "./add-item-form.module.css";

const T = DASHBOARD_UI_AR;

type Props = {
  /** `GET /menu-categories`: an existing one (decision 1). */
  categories: MenuCategory[];
  /** Added: the screen reads the menu again — the item, last in its category. */
  onAdded: () => void;
  onCancel: () => void;
};

type FieldErrors = { name: string | null; price: string | null };

/**
 * «أضف صنفا» (brief ي-ب §6): a form in the page, not a window — the
 * category, the name, the price, «أضف» and «إلغاء». Checked by the API's
 * rules before sending (texts 16); a 409 `menu_too_long` is text 17.
 */
export function AddItemForm({ categories, onAdded, onCancel }: Props) {
  const id = useId();
  const name = useRef<HTMLInputElement>(null);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [draft, setDraft] = useState<Draft>({ name: "", price: "" });
  const [errors, setErrors] = useState<FieldErrors>({
    name: null,
    price: null,
  });
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Opened: straight to the name — the category is already chosen.
  useEffect(() => {
    name.current?.focus();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const decision = addDecision(categoryId, draft);
    if (decision.kind === "invalid") {
      setErrors({ name: decision.name, price: decision.price });
      return;
    }
    setErrors({ name: null, price: null });
    setLine(null);
    setBusy(true);
    const res = await menuApi.createItem(decision.body);
    setBusy(false);
    if (res.ok) onAdded();
    else setLine(menuErrorLine(res.error));
  }

  return (
    <form
      className={styles.form}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      noValidate
    >
      <label className={`${styles.field} ${styles.category}`}>
        <span className={styles.label}>{T.menu.fields.category}</span>
        <select
          className={styles.input}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className={`${styles.field} ${styles.name}`}>
        <span className={styles.label}>{T.menu.fields.name}</span>
        <input
          ref={name}
          className={styles.input}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          dir="auto"
          autoComplete="off"
          aria-invalid={errors.name !== null}
          aria-describedby={errors.name ? `${id}-name` : undefined}
        />
        {errors.name && (
          <span id={`${id}-name`} className={styles.fieldError}>
            {errors.name}
          </span>
        )}
      </label>
      <label className={`${styles.field} ${styles.price}`}>
        <span className={styles.label}>{T.menu.fields.price}</span>
        <input
          className={`num ${styles.input}`}
          value={draft.price}
          onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          inputMode="decimal"
          dir="ltr"
          autoComplete="off"
          aria-invalid={errors.price !== null}
          aria-describedby={errors.price ? `${id}-price` : undefined}
        />
        {errors.price && (
          <span id={`${id}-price`} className={styles.fieldError}>
            {errors.price}
          </span>
        )}
      </label>
      <div className={styles.end}>
        <div className={styles.buttons}>
          <button
            type="submit"
            className={styles.primary}
            disabled={busy}
            aria-busy={busy}
          >
            {T.menu.addSubmit}
          </button>
          <button type="button" className={styles.button} onClick={onCancel}>
            {T.menu.cancel}
          </button>
        </div>
        {line && (
          <p className={styles.line} role="status">
            {line}
          </p>
        )}
      </div>
    </form>
  );
}
