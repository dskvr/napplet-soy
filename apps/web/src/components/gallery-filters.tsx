import type { GallerySearch } from '../../../../packages/protocol/src';
import type { DiscoveryFacets } from '../../../../packages/protocol/src/topics';

const advanced = [
  ['intent', 'intents', 'Accepted intent'],
  ['requiredDomain', 'requiredDomains', 'Required capability'],
  ['optionalDomain', 'optionalDomains', 'Optional integration'],
] as const;

function Options({
  options,
  selected,
  any,
}: {
  options: DiscoveryFacets['archetypes'];
  selected: string;
  any: string;
}) {
  return (
    <>
      <option value="">{any}</option>
      {selected && !options.some(({ value }) => value === selected) && (
        <option value={selected}>{selected} (0)</option>
      )}
      {options.map(({ value, count }) => (
        <option key={value} value={value}>
          {value} ({count})
        </option>
      ))}
    </>
  );
}

export function GalleryFilters({
  search,
  facets,
  disabled,
  update,
}: {
  search: GallerySearch;
  facets: DiscoveryFacets;
  disabled: boolean;
  update: (patch: Partial<GallerySearch>) => void;
}) {
  const count = advanced.filter(([field]) => search[field]).length;
  return (
    <div className="gallery-discovery-controls">
      <form action="/" method="get" className="gallery-archetype">
        {Object.entries(search).map(([key, value]) =>
          key !== 'archetype' && key !== 'page' && value && !(key === 'sort' && value === 'new') ? (
            <input key={key} type="hidden" name={key} value={String(value)} />
          ) : null,
        )}
        <label>
          Archetype
          <select
            name="archetype"
            key={search.archetype ?? ''}
            defaultValue={search.archetype ?? ''}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            <Options
              options={facets.archetypes}
              selected={search.archetype ?? ''}
              any="All archetypes"
            />
          </select>
        </label>
        <button type="submit" hidden={!disabled}>
          Apply
        </button>
        <a href="https://archetypes.napplet.run/">Archetype guide ↗</a>
      </form>
      <details className="gallery-filters" open={count > 0 || undefined}>
        <summary>More filters{count > 0 && <span>{count} active</span>}</summary>
        <div className="gallery-filter-fields">
          {advanced.map(([field, group, label]) => (
            <label key={field}>
              <span>{label}</span>
              <select
                disabled={disabled}
                value={search[field] ?? ''}
                onChange={(event) => update({ [field]: event.target.value || undefined })}
              >
                <Options options={facets[group]} selected={search[field] ?? ''} any="Any" />
              </select>
            </label>
          ))}
        </div>
        <p>Find napplets by what their creators advertise. Counts cover this collection.</p>
        {count > 0 && (
          <button
            className="text-link"
            onClick={() =>
              update({
                intent: undefined,
                requiredDomain: undefined,
                optionalDomain: undefined,
              })
            }
          >
            Clear these filters
          </button>
        )}
      </details>
    </div>
  );
}
