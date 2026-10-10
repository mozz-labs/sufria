"use client";

import { memo, useId, useState, type FormEvent } from "react";
import {
  DASHBOARD_UI_AR,
  type Currency,
  type MenuItemListItem,
} from "@sufria/shared";
import { menuApi } from "../api/menu-api.ts";
import {
  isUnsaved,
  itemErrorLine,
  rowView,
  saveDecision,
  type Draft,
} from "../lib/menu.ts";
import styles from "./menu-row.module.css";

const T = DASHBOARD_UI_AR;

type Props = {
  item: MenuItemListItem;
  currency: Currency;
  /** The item from the API's answer: replaced in its place. */
  onChanged: (item: MenuItemListItem) => void;
  /** «إزالة»: the screen asks first (decision 6). */
  onRemove: (item: MenuItemListItem) => void;
};

type FieldErrors = { name: string | null; price: string | null };
const NO_ERRORS: FieldErrors = { name: null, price: null };

/**
 * One item of the menu (brief ي-ب §6): its name, its price with the
 * currency, its state in a word, and «أطفئ»/«شغّل» · «تعديل» · «إزالة».
 * Nothing changes on the screen before the API answers. «تعديل» turns the
 * name and the price into fields in the row itself (decision 2), «حفظ» and
 * «إلغاء» always beside them; Enter saves and Esc cancels on a keyboard
 * that has them. Memoised: one row's change does not redraw a hundred.
 */
export const MenuRow = memo(function MenuRow({
  item,
  currency,
  onChanged,
  onRemove,
}: Props) {
  const view = rowView(item, currency);
  const id = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"toggle" | "save" | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>(NO_ERRORS);

  async function toggle() {
    setBusy("toggle");
    setLine(null);
    const res = await menuApi.updateItem(item.id, {
      isAvailable: view.toggle.isAvailable,
    });
    setBusy(null);
    if (res.ok) onChanged(res.value);
    else setLine(itemErrorLine(res.error));
  }

  function edit() {
    setDraft({ name: item.name, price: item.price });
    setLine(null);
    setErrors(NO_ERRORS);
  }

  function cancel() {
    setDraft(null);
    setLine(null);
    setErrors(NO_ERRORS);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft || busy) return;
    const decision = saveDecision(item, draft);
    if (decision.kind === "nothing") return cancel();
    if (decision.kind === "invalid") {
      setErrors({ name: decision.name, price: decision.price });
      return;
    }
    setErrors(NO_ERRORS);
    setLine(null);
    setBusy("save");
    const res = await menuApi.updateItem(item.id, decision.body);
    setBusy(null);
    if (res.ok) {
      setDraft(null);
      onChanged(res.value);
    } else setLine(itemErrorLine(res.error));
  }

  if (draft) {
    const unsaved = isUnsaved(item, draft);
    return (
      <li className={styles.row}>
        <form
          className={styles.edit}
          onSubmit={save}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          noValidate
        >
          <label className={`${styles.field} ${styles.nameField}`}>
            <span className={styles.label}>{T.menu.fields.name}</span>
            <input
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
          <label className={`${styles.field} ${styles.priceField}`}>
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
          <div className={styles.editButtons}>
            <button
              type="submit"
              className={styles.button}
              disabled={busy === "save"}
              aria-busy={busy === "save"}
            >
              {T.menu.save}
            </button>
            <button type="button" className={styles.button} onClick={cancel}>
              {T.menu.cancel}
            </button>
            {unsaved && (
              <span className={styles.unsaved}>{T.menu.unsaved}</span>
            )}
          </div>
        </form>
        {line && (
          <p className={styles.line} role="status">
            {line}
          </p>
        )}
      </li>
    );
  }

  return (
    <li className={styles.row} data-off={item.isAvailable ? undefined : ""}>
      <div className={styles.view}>
        <span className={styles.name} dir="auto">
          {view.name}
        </span>
        <span className={`num ${styles.price}`}>{view.amount}</span>
        <span className={styles.status}>{view.status}</span>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            onClick={toggle}
            disabled={busy !== null}
            aria-busy={busy === "toggle"}
          >
            {view.toggle.label}
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={edit}
            disabled={busy !== null}
          >
            {T.menu.edit}
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => onRemove(item)}
            disabled={busy !== null}
          >
            {T.menu.remove}
          </button>
        </div>
      </div>
      {line && (
        <p className={styles.line} role="status">
          {line}
        </p>
      )}
    </li>
  );
});
