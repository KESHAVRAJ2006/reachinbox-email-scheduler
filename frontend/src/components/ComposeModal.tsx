import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ClipboardPaste, FileText, Upload, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { formatDateTime, toDateTimeInputValue } from '../lib/format';
import { parseRecipients } from '../lib/recipients';
import type { Sender } from '../lib/types';
import { useToast } from './Toasts';
import { Button, Spinner } from './ui';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_RECIPIENTS = 10_000;

type Props = { open: boolean; onClose: () => void; onScheduled: () => void };
type FieldErrors = Partial<Record<'senderId' | 'subject' | 'body' | 'recipients' | 'startAt' | 'delayBetweenMs' | 'hourlyLimit', string>>;

function defaultStartAt() {
  return toDateTimeInputValue(new Date(Date.now() + 2 * 60_000)); // two minutes from now
}

export function ComposeModal({ open, onClose, onScheduled }: Props) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [senders, setSenders] = useState<Sender[] | null>(null);
  const [sendersError, setSendersError] = useState<string | null>(null);
  const [senderId, setSenderId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipientText, setRecipientText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [startAt, setStartAt] = useState(defaultStartAt);
  const [delaySeconds, setDelaySeconds] = useState('2');
  const [hourlyLimit, setHourlyLimit] = useState('100');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // Load the sender list each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setSendersError(null);
    api.senders().then(
      ({ senders }) => {
        setSenders(senders);
        setSenderId((current) => current || senders[0]?.id || '');
      },
      (err: Error) => setSendersError(err.message),
    );
  }, [open]);

  // Escape closes the modal (unless a submit is in flight).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && !submitting && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, submitting, onClose]);

  // Re-parse only when the text changes, not on every keystroke in other fields.
  const parsed = useMemo(() => parseRecipients(recipientText), [recipientText]);

  if (!open) return null;

  // Editing a field removes its error message; the rest stay until the next submit.
  function edit<T>(field: keyof FieldErrors, setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    };
  }

  function reset() {
    setSubject('');
    setBody('');
    setRecipientText('');
    setFileName(null);
    setPasteMode(false);
    setStartAt(defaultStartAt());
    setErrors({});
  }

  async function loadFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setErrors((e) => ({ ...e, recipients: 'File is larger than 5 MB.' }));
      return;
    }
    setRecipientText(await file.text()); // read in the browser; the server only receives the addresses
    setFileName(file.name);
    setPasteMode(false);
    setErrors((e) => ({ ...e, recipients: undefined }));
  }

  // Same rules as the API, checked first so the user gets instant feedback.
  function validate(): FieldErrors {
    const found: FieldErrors = {};
    if (!senderId) found.senderId = 'Choose a sender.';
    if (!subject.trim()) found.subject = 'Subject is required.';
    if (!body.trim()) found.body = 'Write the email body.';
    if (parsed.emails.length === 0) found.recipients = 'Add at least one valid email address.';
    else if (parsed.emails.length > MAX_RECIPIENTS) found.recipients = `At most ${MAX_RECIPIENTS.toLocaleString()} recipients per campaign.`;
    if (!startAt || Number.isNaN(new Date(startAt).getTime())) found.startAt = 'Pick a start time.';
    const delay = Number(delaySeconds);
    if (!Number.isFinite(delay) || delay < 0 || delay > 86_400) found.delayBetweenMs = 'Between 0 and 86400 seconds.';
    const limit = Number(hourlyLimit);
    if (!Number.isInteger(limit) || limit < 1) found.hourlyLimit = 'A whole number, at least 1.';
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const result = await api.createCampaign({
        senderId,
        subject: subject.trim(),
        body: body.trim(),
        recipients: parsed.emails,
        // datetime-local has no timezone: new Date() reads it as the user's local
        // time, and toISOString() converts it to UTC for the API.
        startAt: new Date(startAt).toISOString(),
        delayBetweenMs: Math.round(Number(delaySeconds) * 1000),
        hourlyLimit: Number(hourlyLimit),
      });
      const plural = result.totalEmails === 1 ? '' : 's';
      const timing = result.totalEmails > 1
        ? `First send ${formatDateTime(result.firstSendAt)}, last ${formatDateTime(result.lastSendAt)}.`
        : `Sends ${formatDateTime(result.firstSendAt)}.`;
      toast.success(`Scheduled ${result.totalEmails} email${plural}`, timing);
      reset();
      onScheduled();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        // Show the server's per-field messages next to the matching inputs.
        const serverErrors: FieldErrors = {};
        for (const detail of err.details) serverErrors[detail.field.split('.')[0] as keyof FieldErrors] = detail.message;
        setErrors(serverErrors);
      }
      toast.error('Could not schedule the campaign', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const count = parsed.emails.length;
  const limit = Number(hourlyLimit) || 1;
  const hoursNeeded = Math.ceil(count / limit);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !submitting && onClose()}>
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-title"
        className="flex max-h-[95vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 id="compose-title" className="text-base font-semibold text-slate-900">New campaign</h2>
          <button type="button" onClick={onClose} disabled={submitting} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <Field label="From" error={errors.senderId}>
            {sendersError ? (
              <p className="text-sm text-rose-600">{sendersError}</p>
            ) : !senders ? (
              <Spinner label="Loading senders..." />
            ) : senders.length === 0 ? (
              <p className="text-sm text-slate-500">No senders yet. Run <code className="rounded bg-slate-100 px-1">npm run seed:senders</code> in the backend.</p>
            ) : (
              <select value={senderId} onChange={(e) => edit('senderId', setSenderId)(e.target.value)} className={inputClass(errors.senderId)}>
                {senders.map((sender) => (
                  <option key={sender.id} value={sender.id}>{sender.name} — {sender.email}</option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Subject" error={errors.subject}>
            <input value={subject} onChange={(e) => edit('subject', setSubject)(e.target.value)} maxLength={200} placeholder="Quick question about your hiring plans" className={inputClass(errors.subject)} />
          </Field>

          <Field label="Body" error={errors.body}>
            <textarea value={body} onChange={(e) => edit('body', setBody)(e.target.value)} rows={6} maxLength={20_000} placeholder="Hi there, ..." className={inputClass(errors.body)} />
          </Field>

          <Field
            label="Recipients"
            error={errors.recipients}
            aside={
              <button type="button" onClick={() => { setPasteMode((v) => !v); setFileName(null); }} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500">
                {pasteMode ? <><Upload className="size-3.5" /> Upload CSV instead</> : <><ClipboardPaste className="size-3.5" /> Paste addresses instead</>}
              </button>
            }
          >
            {pasteMode ? (
              <textarea value={recipientText} onChange={(e) => edit('recipients', setRecipientText)(e.target.value)} rows={4} placeholder={'alice@example.com\nbob@example.com'} className={`${inputClass(errors.recipients)} font-mono text-xs`} />
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault(); // stop the browser from opening the file
                  setDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file) void loadFile(file);
                }}
                onClick={() => fileInput.current?.click()}
                className={`flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-6 text-center transition ${dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-slate-400'}`}
              >
                {fileName ? (
                  <>
                    <FileText className="size-7 text-indigo-600" />
                    <p className="mt-2 text-sm font-medium text-slate-900">{fileName}</p>
                    <p className="text-xs text-slate-500">Click or drop another file to replace it</p>
                  </>
                ) : (
                  <>
                    <Upload className="size-7 text-slate-400" />
                    <p className="mt-2 text-sm text-slate-700"><span className="font-medium text-indigo-600">Upload a CSV</span> or drag it here</p>
                    <p className="text-xs text-slate-500">Any column with email addresses works; header rows are skipped</p>
                  </>
                )}
                <input ref={fileInput} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ''; }} />
              </div>
            )}

            {recipientText.trim() && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                <p className="font-medium text-slate-900">
                  {count.toLocaleString()} recipient{count === 1 ? '' : 's'}
                  {(parsed.duplicates > 0 || parsed.skippedLines > 0) && (
                    <span className="font-normal text-slate-500">
                      {parsed.duplicates > 0 && ` · ${parsed.duplicates} duplicate${parsed.duplicates === 1 ? '' : 's'} removed`}
                      {parsed.skippedLines > 0 && ` · ${parsed.skippedLines} line${parsed.skippedLines === 1 ? '' : 's'} without an address skipped`}
                    </span>
                  )}
                </p>
                {count > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {parsed.emails.slice(0, 6).map((email) => (
                      <span key={email} className="rounded-md bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200">{email}</span>
                    ))}
                    {count > 6 && <span className="px-1 py-0.5 text-xs text-slate-500">+{(count - 6).toLocaleString()} more</span>}
                  </div>
                )}
              </div>
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Start at" error={errors.startAt}>
              <input type="datetime-local" value={startAt} onChange={(e) => edit('startAt', setStartAt)(e.target.value)} className={inputClass(errors.startAt)} />
            </Field>
            <Field label="Delay (seconds)" error={errors.delayBetweenMs}>
              <input type="number" min={0} step="any" value={delaySeconds} onChange={(e) => edit('delayBetweenMs', setDelaySeconds)(e.target.value)} className={inputClass(errors.delayBetweenMs)} />
            </Field>
            <Field label="Max per hour" error={errors.hourlyLimit}>
              <input type="number" min={1} step={1} value={hourlyLimit} onChange={(e) => edit('hourlyLimit', setHourlyLimit)(e.target.value)} className={inputClass(errors.hourlyLimit)} />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-slate-500">
            Delay is the gap between two emails of this campaign. Max per hour caps how many of them go out in any clock hour.
            {count > limit && ` At ${limit.toLocaleString()} per hour, these ${count.toLocaleString()} emails spread over about ${hoursNeeded} hours.`}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:rounded-b-2xl">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" loading={submitting}>
            Schedule {count > 0 ? `${count.toLocaleString()} email${count === 1 ? '' : 's'}` : 'campaign'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function inputClass(error?: string) {
  return `block w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:outline-none ${
    error ? 'ring-rose-300 focus:ring-rose-500' : 'ring-slate-300 focus:ring-indigo-600'
  }`;
}

function Field({ label, hint, error, aside, children }: { label: string; hint?: string; error?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-sm font-medium text-slate-700">
          {label} {hint && <span className="font-normal text-slate-400">({hint})</span>}
        </label>
        {aside}
      </div>
      {children}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
