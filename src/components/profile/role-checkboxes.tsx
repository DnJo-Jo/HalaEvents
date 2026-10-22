import { ACCOUNT_ROLE_LABELS, AccountRole } from "@/modules/profiles/schemas";

export function RoleCheckboxes({ selected, error }: { selected: AccountRole[]; error?: string }) {
  return (
    <fieldset className="space-y-2" aria-describedby={error ? "roles-error" : undefined}>
      <legend className="mb-1 text-sm font-medium text-ink">How will you use HalaEvents?</legend>
      {AccountRole.options.map((role) => (
        <label
          key={role}
          className="flex cursor-pointer gap-3 rounded-md border border-line p-3 transition-colors hover:bg-surface-muted has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
        >
          <input
            type="checkbox"
            name="roles"
            value={role}
            defaultChecked={selected.includes(role)}
            className="mt-0.5 size-4 accent-[var(--primary)]"
          />
          <span>
            <span className="block text-sm font-medium">{ACCOUNT_ROLE_LABELS[role].label}</span>
            <span className="block text-xs text-ink-muted">
              {ACCOUNT_ROLE_LABELS[role].description}
            </span>
          </span>
        </label>
      ))}
      <p className="text-xs text-ink-muted">
        You can change this later. Provider listings are reviewed by the HalaEvents team before
        they&rsquo;re shown to organizers.
      </p>
      {error && (
        <p id="roles-error" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
