import { PebbleTemplate } from "../../classes/template";

export interface PebbleTemplateRNParams {
  type: 'xml' | 'compact';
}
export const PebbleTemplateRN: PebbleTemplate<PebbleTemplateRNParams> = {
  name: 'Schematron',
  fields: {
    type: {
        label: 'Document type',
        options: [
            { label: 'XML', value: 'xml' },
            { label: 'Compact', value: 'compact' },
        ]
    },
  },
  defaults: {
    type: 'compact',
  },
  ext: ({ type }: PebbleTemplateRNParams) => type === 'xml' ? 'rng' : 'rnc',
  execute: ({ type }: PebbleTemplateRNParams) => type === 'xml' ? `<?xml version="1.0" encoding="UTF-8"?>
<grammar 
    xmlns="http://relaxng.org/ns/structure/1.0"
    xmlns:a="http://relaxng.org/ns/compatibility/annotations/1.0"
    datatypeLibrary="http://www.w3.org/2001/XMLSchema-datatypes">
    <start>
        
        <element name="hello">
            <empty/>
        </element>

    </start>
</grammar>
` : `datatypes xsd = "http://www.w3.org/2001/XMLSchema-datatypes"

element hello { empty }
`,
};