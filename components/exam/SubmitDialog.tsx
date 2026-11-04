"use client";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

export function SubmitDialog({
  open,
  onClose,
  onConfirm,
  total,
  unanswered,
  marked,
  submitting,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  total: number;
  unanswered: number;
  marked: number;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <Dialog
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title="Submit your examination?"
      description="You won’t be able to change your answers after submitting."
      footer={
        <>
          <Button onClick={onClose} disabled={submitting} data-autofocus>
            Return to exam
          </Button>
          <Button variant="primary" onClick={onConfirm} loading={submitting}>
            Submit examination
          </Button>
        </>
      }
    >
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line text-center">
        <div className="bg-surface px-3 py-3">
          <dt className="text-[12px] text-ink-3">Answered</dt>
          <dd className="text-lg font-semibold text-ink tabular">{total - unanswered}</dd>
        </div>
        <div className="bg-surface px-3 py-3">
          <dt className="text-[12px] text-ink-3">Unanswered</dt>
          <dd className={`text-lg font-semibold tabular ${unanswered ? "text-danger" : "text-ink"}`}>{unanswered}</dd>
        </div>
        <div className="bg-surface px-3 py-3">
          <dt className="text-[12px] text-ink-3">Marked</dt>
          <dd className={`text-lg font-semibold tabular ${marked ? "text-warn" : "text-ink"}`}>{marked}</dd>
        </div>
      </dl>
      {unanswered > 0 && (
        <p className="mt-3 text-[13px] text-ink-2">
          {unanswered} question{unanswered === 1 ? " is" : "s are"} still unanswered and will score zero.
        </p>
      )}
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </Dialog>
  );
}
