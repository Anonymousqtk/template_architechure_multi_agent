import { useState } from 'react';
import { SlideDialog } from '../../../components/common/SlideDialog';
import type { ReportBuilderMessages } from '../reportBuilderMessages';

interface Props {
  msg: ReportBuilderMessages;
  mode: 'SAVE_AS' | 'SHARE';
  initialName: string;
  initialDescription: string;
  initialVisibility: 'PRIVATE' | 'SHARED' | 'ORG_TEMPLATE';
  initialSharedRoles: Array<'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE'>;
  initialIsTemplate: boolean;
  canPublishTemplate: boolean;
  submitting: boolean;
  onSubmit: (payload: {
    name: string;
    description: string;
    changeNote: string;
    visibility: 'PRIVATE' | 'SHARED' | 'ORG_TEMPLATE';
    sharedRoles: Array<'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE'>;
    isTemplate: boolean;
  }) => void;
  onClose: () => void;
}

const ROLES: Array<'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE'> = [
  'ADMIN',
  'HR',
  'MANAGER',
  'EMPLOYEE',
];

export function ShareReportModal({
  msg,
  mode,
  initialName,
  initialDescription,
  initialVisibility,
  initialSharedRoles,
  initialIsTemplate,
  canPublishTemplate,
  submitting,
  onSubmit,
  onClose,
}: Props) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [changeNote, setChangeNote] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'SHARED' | 'ORG_TEMPLATE'>(
    initialVisibility,
  );
  const [sharedRoles, setSharedRoles] =
    useState<Array<'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE'>>(initialSharedRoles);
  const [isTemplate, setIsTemplate] = useState(initialIsTemplate);

  const toggleRole = (r: 'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE') => {
    setSharedRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  };

  return (
    <SlideDialog
      label={mode === 'SHARE' ? msg.shareModal.title : msg.shareModal.saveAsTitle}
      onClose={onClose}
      closeDisabled={submitting}
      action={
        <button
          type="button"
          className="primary"
          disabled={submitting || !name.trim()}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              description: description.trim(),
              changeNote: changeNote.trim(),
              visibility: isTemplate ? 'ORG_TEMPLATE' : visibility,
              sharedRoles,
              isTemplate,
            })
          }
        >
          {mode === 'SHARE' ? msg.shareModal.confirmShare : msg.shareModal.confirmSave}
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <h3>{mode === 'SHARE' ? msg.shareModal.title : msg.shareModal.saveAsTitle}</h3>

        <div>
          <label className="rbs-label" htmlFor="rbs-save-name">
            {msg.shareModal.nameLabel}
          </label>
          <input
            id="rbs-save-name"
            className="rbs-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="rbs-label" htmlFor="rbs-save-desc">
            {msg.shareModal.descriptionLabel}
          </label>
          <textarea
            id="rbs-save-desc"
            rows={2}
            className="rbs-input"
            style={{ height: 'auto', padding: '0.5rem 0.65rem' }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div>
          <label className="rbs-label" htmlFor="rbs-save-note">
            {msg.shareModal.changeNoteLabel}
          </label>
          <input
            id="rbs-save-note"
            className="rbs-input"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
          />
        </div>

        <div>
          <label className="rbs-label" htmlFor="rbs-save-vis">
            {msg.shareModal.visibilityLabel}
          </label>
          <select
            id="rbs-save-vis"
            className="rbs-select"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as 'PRIVATE' | 'SHARED' | 'ORG_TEMPLATE')}
          >
            <option value="PRIVATE">{msg.library.visibilityPrivate}</option>
            <option value="SHARED">{msg.library.visibilityShared}</option>
            {canPublishTemplate && (
              <option value="ORG_TEMPLATE">{msg.library.visibilityTemplate}</option>
            )}
          </select>
        </div>

        {visibility === 'SHARED' && (
          <div>
            <div className="rbs-label">{msg.shareModal.sharedRolesLabel}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem' }}>
              {ROLES.map((r) => (
                <label key={r} className="rbs-check-row">
                  <input
                    type="checkbox"
                    checked={sharedRoles.includes(r)}
                    onChange={() => toggleRole(r)}
                  />
                  <span>{r}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {canPublishTemplate && (
          <label className="rbs-check-row">
            <input
              type="checkbox"
              checked={isTemplate}
              onChange={(e) => setIsTemplate(e.target.checked)}
            />
            <span>{msg.shareModal.isTemplateLabel}</span>
          </label>
        )}
      </div>
    </SlideDialog>
  );
}
