"use client";

import { useState } from "react";

// Structured output field schema — the core of Umair's example use cases
// (a list of fields with type, allowed values, missing-behaviour, order and
// extraction rule). Maps to the V1 blueprint `target_output_spec.fields`.
// First version: mock example data (factory safety-observation case), row-click
// detail. Editing + real data come with the agent (#29/#31) and the extended
// BlueprintContent API (Janne).

export type FieldSpec = {
  name: string;
  type: "text" | "enum" | "date" | "number" | "boolean";
  allowedValues?: string[];
  required: boolean;
  missingBehavior: "empty" | "default";
  defaultValue?: string;
  rule?: string;
};

// Example data from Umair's factory safety-observation use case.
const EXAMPLE_FIELDS: FieldSpec[] = [
  {
    name: "Havaintotyyppi",
    type: "enum",
    allowedValues: ["Near miss", "safety observation", "deviation"],
    required: true,
    missingBehavior: "default",
    defaultValue: "safety observation",
    rule: "Valitse vain yksi arvoista. Jos ei pääteltävissä → oletus.",
  },
  {
    name: "Havainto- ja poikkeamatyyppi",
    type: "enum",
    allowedValues: ["Kalusto", "Laatu", "Alihankinta", "Ympäristö", "Asiakas", "Turvallisuus"],
    required: true,
    missingBehavior: "default",
    defaultValue: "Turvallisuus",
    rule: "Valitse vain yksi. Jos ei pääteltävissä → 'Turvallisuus'.",
  },
  {
    name: "Päivämäärä",
    type: "date",
    required: false,
    missingBehavior: "empty",
    rule: "Tapahtuman päivämäärä. Palauta \"\" jos ei saatavilla.",
  },
  {
    name: "Työnantaja",
    type: "text",
    required: false,
    missingBehavior: "empty",
    rule: "Litteraatiossa mainittu alihankkijan/työnantajan/yrityksen nimi.",
  },
  {
    name: "Kirjaaja",
    type: "text",
    required: false,
    missingBehavior: "empty",
    rule: "Havainnon kirjaavan henkilön nimi.",
  },
  {
    name: "Tapahtumaselostus",
    type: "text",
    required: true,
    missingBehavior: "empty",
    rule: "Tarkka kuvaus havainnosta tai poikkeamasta.",
  },
  {
    name: "Tapahtumaan johtaneet tekijät",
    type: "text",
    required: false,
    missingBehavior: "empty",
    rule: "Kuvaus tapahtumaan johtaneista tekijöistä.",
  },
  {
    name: "Tehdyt välittömät toimenpiteet",
    type: "text",
    required: false,
    missingBehavior: "empty",
    rule: "Kuvaus välittömistä tehdyistä toimenpiteistä.",
  },
  {
    name: "Ehdotukset vastaavien tilanteiden välttämiseksi",
    type: "text",
    required: false,
    missingBehavior: "empty",
    rule: "Ehdotukset vastaavien tilanteiden välttämiseksi.",
  },
];

const TYPE_STYLE: Record<FieldSpec["type"], string> = {
  text: "bg-neutral-bg text-neutral-text border-neutral-border",
  enum: "bg-brand-soft text-brand-text border-brand-soft-border",
  date: "bg-info-bg text-info-text border-info-border",
  number: "bg-info-bg text-info-text border-info-border",
  boolean: "bg-neutral-bg text-neutral-text border-neutral-border",
};

export function FieldSchemaEditor({ fields }: { fields?: FieldSpec[] }) {
  const rows = fields && fields.length ? fields : EXAMPLE_FIELDS;
  const [sel, setSel] = useState(0);
  const f = rows[sel];

  return (
    <div className="mx-auto w-full max-w-3xl py-1">
      <div className="mb-4">
        <span className="section-kicker text-gold">Kenttäskeema</span>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-text">
          Poimittavat kentät
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          {rows.length} kenttää · tarkka järjestys · ei arvauksia. Tämä on
          tuotoksen rakenteinen määrittely (esimerkkidata).
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="grid grid-cols-[1.6rem_1fr_auto] gap-2 border-b border-border bg-surface-muted px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">
            <span>#</span>
            <span>Kenttä</span>
            <span>Tyyppi</span>
          </div>
          <ul>
            {rows.map((row, i) => (
              <li key={i}>
                <button
                  onClick={() => setSel(i)}
                  className={`grid w-full grid-cols-[1.6rem_1fr_auto] items-center gap-2 border-b border-border px-3 py-2.5 text-left transition-colors ${
                    i === sel ? "bg-brand-soft/60" : "hover:bg-surface-muted"
                  }`}
                >
                  <span className="text-xs font-semibold text-text-muted">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text">
                      {row.name}
                    </span>
                    {row.required && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-danger-text">
                        pakollinen
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${TYPE_STYLE[row.type]}`}
                  >
                    {row.type}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Detail */}
        <div className="h-fit rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gold">
            Kenttä #{sel + 1}
          </div>
          <h3 className="mt-0.5 text-lg font-bold text-text">{f.name}</h3>

          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
                Tyyppi
              </dt>
              <dd className="text-text">{f.type}</dd>
            </div>
            {f.type === "enum" && f.allowedValues && (
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
                  Sallitut arvot
                </dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {f.allowedValues.map((v) => (
                    <span
                      key={v}
                      className="rounded-md border border-brand-soft-border bg-brand-soft px-1.5 py-0.5 text-xs text-brand-text"
                    >
                      {v}
                    </span>
                  ))}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
                Jos arvo puuttuu
              </dt>
              <dd className="text-text">
                {f.missingBehavior === "empty"
                  ? 'jätä tyhjäksi ""'
                  : `oletus: ${f.defaultValue ?? "—"}`}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
                Pakollinen
              </dt>
              <dd className="text-text">{f.required ? "Kyllä" : "Valinnainen"}</dd>
            </div>
            {f.rule && (
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
                  Poimintasääntö
                </dt>
                <dd className="text-text-secondary">{f.rule}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
