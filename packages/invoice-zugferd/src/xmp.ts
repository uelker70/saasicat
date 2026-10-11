// The XMP metadata of the PDF: PDF/A-3 conformance level B, the Factur-X
// properties a program finds the embedded XML by, and the extension schema
// that declares them — PDF/A refuses a property no schema declares (ISO
// 19005-3, 6.6.2.3). What the document information dictionary says, the
// metadata says alike (6.6.3).

import { xmlText } from './format.js';

export interface XmpFacts {
    title: string;
    producer: string;
    creatorTool: string;
    /** The invoice's moment of issue: the document is created and last changed then. */
    at: Date;
    fileName: string;
    conformanceLevel: string;
}

/** A moment as XMP writes it: to the second, in UTC. */
function xmpDate(at: Date): string {
    return `${at.toISOString().slice(0, 19)}Z`;
}

/** The Factur-X schema's properties, declared as PDF/A asks of an extension. */
const FACTUR_X_SCHEMA = [
    ['DocumentFileName', 'The name of the embedded XML document'],
    ['DocumentType', 'The type of the hybrid document in capital letters, e.g. INVOICE or ORDER'],
    ['Version', 'The actual version of the standard applying to the embedded XML document'],
    ['ConformanceLevel', 'The conformance level of the embedded XML document'],
]
    .map(
        ([name, description]) =>
            '<rdf:li rdf:parseType="Resource">' +
            `<pdfaProperty:name>${name}</pdfaProperty:name>` +
            '<pdfaProperty:valueType>Text</pdfaProperty:valueType>' +
            '<pdfaProperty:category>external</pdfaProperty:category>' +
            `<pdfaProperty:description>${description}</pdfaProperty:description>` +
            '</rdf:li>',
    )
    .join('');

export function xmpOf(facts: XmpFacts): string {
    const at = xmpDate(facts.at);
    return (
        '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
        '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">' +
        '<pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance>' +
        '</rdf:Description>' +
        '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        '<dc:format>application/pdf</dc:format>' +
        `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(facts.title)}</rdf:li></rdf:Alt></dc:title>` +
        '</rdf:Description>' +
        '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">' +
        `<xmp:CreatorTool>${xmlText(facts.creatorTool)}</xmp:CreatorTool>` +
        `<xmp:CreateDate>${at}</xmp:CreateDate>` +
        `<xmp:ModifyDate>${at}</xmp:ModifyDate>` +
        `<xmp:MetadataDate>${at}</xmp:MetadataDate>` +
        '</rdf:Description>' +
        '<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">' +
        `<pdf:Producer>${xmlText(facts.producer)}</pdf:Producer>` +
        '</rdf:Description>' +
        '<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">' +
        '<fx:DocumentType>INVOICE</fx:DocumentType>' +
        `<fx:DocumentFileName>${xmlText(facts.fileName)}</fx:DocumentFileName>` +
        '<fx:Version>1.0</fx:Version>' +
        `<fx:ConformanceLevel>${xmlText(facts.conformanceLevel)}</fx:ConformanceLevel>` +
        '</rdf:Description>' +
        '<rdf:Description rdf:about=""' +
        ' xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"' +
        ' xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"' +
        ' xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">' +
        '<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">' +
        '<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>' +
        '<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>' +
        '<pdfaSchema:prefix>fx</pdfaSchema:prefix>' +
        `<pdfaSchema:property><rdf:Seq>${FACTUR_X_SCHEMA}</rdf:Seq></pdfaSchema:property>` +
        '</rdf:li></rdf:Bag></pdfaExtension:schemas>' +
        '</rdf:Description>' +
        '</rdf:RDF></x:xmpmeta>\n' +
        '<?xpacket end="w"?>'
    );
}
