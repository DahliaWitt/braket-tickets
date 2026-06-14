// 'use node' marks this module Node-only so the Convex deploy-time analyzer
// skips V8 bundling of @react-pdf/renderer → yoga-layout (uses import.meta).
// All importers must also be 'use node'. Same pattern as lib/stripe_node.ts.
'use node';

import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from '@react-pdf/renderer';
import * as fontkit from 'fontkit';
import {SYNE_800_BASE64} from './fonts/syne_800';
import {INTER_400_BASE64} from './fonts/inter_400';
import {INTER_700_BASE64} from './fonts/inter_700';
import {SPACE_MONO_400_BASE64} from './fonts/space_mono_400';
import {SPACE_MONO_700_BASE64} from './fonts/space_mono_700';
import {EVENT_DATE_TIME_ZONE} from './timezone';

export interface TicketPdfData {
  eventTitle: string;
  promoterName: string;
  attendeeName: string;
  eventDate: number;
  ticketId: string;
  qrCodeDataUrl: string;
  location?: string;
}

Font.register({
  family: 'Syne',
  fonts: [{src: `data:font/ttf;base64,${SYNE_800_BASE64}`, fontWeight: 800}],
});

Font.register({
  family: 'Inter',
  fonts: [
    {src: `data:font/ttf;base64,${INTER_400_BASE64}`, fontWeight: 400},
    {src: `data:font/ttf;base64,${INTER_700_BASE64}`, fontWeight: 700},
  ],
});

Font.register({
  family: 'Space Mono',
  fonts: [
    {src: `data:font/ttf;base64,${SPACE_MONO_400_BASE64}`, fontWeight: 400},
    {src: `data:font/ttf;base64,${SPACE_MONO_700_BASE64}`, fontWeight: 700},
  ],
});

Font.registerHyphenationCallback((word) => [word]);

// PDF print palette. Canonical brand tokens for emailed ticket attachments —
// independent of the web Tailwind theme since print surfaces and lighting
// differ.
const COLOR_PAPER = '#F2EEE4';
const COLOR_INK = '#141416';
const COLOR_ACCENT = '#D8275C';
// Darkened from #7A7A7A to clear WCAG AA contrast (≥4.5:1 vs paper) at the
// 8pt mechanical sizes used in the band/footer/kicker.
const COLOR_MUTE = '#5F5F5F';
const MARGIN = 30;
const PAGE_W = 595.28;
const FRAME_INNER_PAD = 26;
const TITLE_AREA_W = PAGE_W - MARGIN * 2 - 2 - FRAME_INNER_PAD * 2;
const QR_PANEL_W = 260;
const ATTENDEE_COLUMN_W = TITLE_AREA_W;

export function formatTicketDateParts(ts: number): {
  weekday: string;
  isoDate: string;
  time: string;
} {
  const d = new Date(ts);
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: EVENT_DATE_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = dateParts.find((candidate) => candidate.type === type)?.value;
    if (value === undefined)
      throw new Error(`Missing ticket date part ${type}`);
    return value;
  };
  const weekday = part('weekday').toUpperCase();
  const isoDate = `${part('year')}.${part('month')}.${part('day')}`;
  const time = d.toLocaleTimeString('en-US', {
    timeZone: EVENT_DATE_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return {weekday, isoDate, time};
}

function shortTicketCode(id: string): string {
  const clean = id.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `TKT-${clean.slice(-8) || clean}`;
}

const TITLE_FONT = fontkit.create(Buffer.from(SYNE_800_BASE64, 'base64'));

function measureWordWidth(word: string, fontSize: number): number {
  if (!word) return 0;
  // fontkit's create() returns Font | FontCollection at the type level; for a
  // single-face TTF buffer it is always Font, so the layout call is safe.
  const font = TITLE_FONT as Extract<typeof TITLE_FONT, {layout: unknown}>;
  const run = font.layout(word);
  const advance = run.advanceWidth;
  return (advance / font.unitsPerEm) * fontSize;
}

interface TitleLine {
  text: string;
  fontSize: number;
  letterSpacing: number;
  lineHeight: number;
}

// Subverted-Swiss display: pick the largest tier that fits in <=3 lines, then
// fully justify every line except the last by computing the letter-spacing
// delta needed to reach exact column width. Real glyph widths from fontkit.
function fitTitleLines(title: string): TitleLine[] {
  const trimmed = title.trim();
  if (!trimmed) return [];
  const words = trimmed.split(/\s+/).filter(Boolean);

  const tiers = [160, 132, 108, 88, 72, 60, 50, 42, 36, 30, 26, 22];

  for (const fontSize of tiers) {
    const baseLs = -fontSize * 0.04;
    const spaceWidth = measureWordWidth(' ', fontSize);

    const longestWord = Math.max(
      ...words.map(
        (w) =>
          measureWordWidth(w.toUpperCase(), fontSize) +
          Math.max(0, w.length - 1) * baseLs,
      ),
    );
    if (longestWord > TITLE_AREA_W) continue;

    const lines: string[][] = [];
    let cur: string[] = [];
    let curW = 0;
    for (const w of words) {
      const wW =
        measureWordWidth(w.toUpperCase(), fontSize) +
        Math.max(0, w.length - 1) * baseLs;
      const tentative = cur.length === 0 ? wW : curW + spaceWidth + baseLs + wW;
      if (tentative <= TITLE_AREA_W) {
        cur.push(w);
        curW = tentative;
      } else {
        lines.push(cur);
        cur = [w];
        curW = wW;
      }
    }
    if (cur.length > 0) lines.push(cur);

    if (lines.length > 3) continue;

    const lineHeight = fontSize >= 110 ? 0.92 : fontSize >= 70 ? 0.96 : 1.02;

    return lines.map((lineWords, idx) => {
      const text = lineWords.map((w) => w.toUpperCase()).join(' ');
      const isLast = idx === lines.length - 1;
      const naturalAdvance = lineWords
        .map((w) => measureWordWidth(w.toUpperCase(), fontSize))
        .reduce((a, b) => a + b, 0);
      const naturalWidth =
        naturalAdvance +
        Math.max(0, lineWords.length - 1) * spaceWidth +
        Math.max(0, text.length - 1) * baseLs;

      // Justify all lines except the last. Single-line titles are left at
      // natural tracking — the largest-tier rule guarantees they already fill
      // most of the column, and stretching short single words looks gimmicky.
      const slots = Math.max(1, text.length - 1);
      const slack = TITLE_AREA_W - naturalWidth;
      const letterSpacing =
        !isLast && slack > 0 ? baseLs + slack / slots : baseLs;

      return {text, fontSize, letterSpacing, lineHeight};
    });
  }

  const fontSize = tiers[tiers.length - 1];
  return [
    {
      text: trimmed.toUpperCase(),
      fontSize,
      letterSpacing: -fontSize * 0.04,
      lineHeight: 1.04,
    },
  ];
}

interface AttendeeFit {
  lines: string[];
  fontSize: number;
  letterSpacing: number;
  lineHeight: number;
}

// Same idea as fitTitleLines but tuned for the QR-zone column. Up to 2 lines,
// natural tracking (not justified) since holder names read better unstretched.
function fitAttendeeName(name: string): AttendeeFit {
  const trimmed = name.trim().toUpperCase();
  if (!trimmed) {
    return {lines: [''], fontSize: 26, letterSpacing: -0.5, lineHeight: 0.96};
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  const tiers = [38, 34, 30, 26, 22, 19, 17, 15];

  for (const fontSize of tiers) {
    const ls = -fontSize * 0.02;
    const spaceWidth = measureWordWidth(' ', fontSize);

    const longest = Math.max(
      ...words.map(
        (w) => measureWordWidth(w, fontSize) + Math.max(0, w.length - 1) * ls,
      ),
    );
    if (longest > ATTENDEE_COLUMN_W) continue;

    const lines: string[][] = [];
    let cur: string[] = [];
    let curW = 0;
    for (const w of words) {
      const wW = measureWordWidth(w, fontSize) + Math.max(0, w.length - 1) * ls;
      const tentative = cur.length === 0 ? wW : curW + spaceWidth + ls + wW;
      if (tentative <= ATTENDEE_COLUMN_W) {
        cur.push(w);
        curW = tentative;
      } else {
        lines.push(cur);
        cur = [w];
        curW = wW;
      }
    }
    if (cur.length > 0) lines.push(cur);

    if (lines.length > 2) continue;

    return {
      lines: lines.map((l) => l.join(' ')),
      fontSize,
      letterSpacing: ls,
      lineHeight: fontSize >= 26 ? 0.96 : 1.0,
    };
  }

  return {lines: [trimmed], fontSize: 14, letterSpacing: -0.2, lineHeight: 1.0};
}

const s = StyleSheet.create({
  page: {
    backgroundColor: COLOR_PAPER,
    padding: MARGIN,
    fontFamily: 'Inter',
    color: COLOR_INK,
  },
  frame: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLOR_INK,
  },

  // Top utility band — function-first metadata, ISO-style date.
  topBand: {
    height: 30,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_INK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
  },
  topBandPair: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  topBandKey: {
    fontFamily: 'Space Mono',
    fontWeight: 700,
    fontSize: 8,
    letterSpacing: 1.6,
    color: COLOR_MUTE,
    marginRight: 8,
  },
  topBandValue: {
    fontFamily: 'Space Mono',
    fontWeight: 700,
    fontSize: 9,
    letterSpacing: 1.4,
    color: COLOR_INK,
  },

  // Hero — justified Swiss title; per-line letter-spacing is set on each Text.
  hero: {
    paddingTop: 36,
    paddingBottom: 30,
    paddingHorizontal: FRAME_INNER_PAD,
  },
  heroKickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  heroKickerMark: {
    width: 16,
    height: 0.75,
    backgroundColor: COLOR_INK,
    marginRight: 12,
  },
  heroKicker: {
    fontFamily: 'Space Mono',
    fontWeight: 700,
    fontSize: 8.5,
    letterSpacing: 2.4,
    color: COLOR_MUTE,
  },
  titleLine: {
    fontFamily: 'Syne',
    fontWeight: 800,
    color: COLOR_INK,
  },
  titleAccent: {
    width: 28,
    height: 2,
    backgroundColor: COLOR_ACCENT,
    marginTop: 22,
  },

  // Perforation — physical tear-line.
  perforation: {
    borderTopWidth: 1,
    borderTopColor: COLOR_INK,
    borderStyle: 'dotted',
  },

  // QR zone — single column, left-aligned to the title axis.
  qrZone: {
    flex: 1,
    flexDirection: 'column',
    paddingVertical: 32,
    paddingHorizontal: FRAME_INNER_PAD,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  holderBlock: {
    alignSelf: 'stretch',
    marginBottom: 28,
  },
  attendeeDisplay: {
    fontFamily: 'Syne',
    fontWeight: 800,
    color: COLOR_INK,
  },
  venueLine: {
    fontFamily: 'Inter',
    fontWeight: 400,
    fontSize: 11,
    letterSpacing: 0.3,
    lineHeight: 1.4,
    color: COLOR_INK,
    marginTop: 14,
  },
  qrPanel: {
    width: QR_PANEL_W,
    height: QR_PANEL_W,
    backgroundColor: '#FFFFFF',
    padding: 12,
  },
  qrImage: {
    width: '100%',
    height: '100%',
  },

  // Footer — sequence + brand.
  footer: {
    height: 30,
    borderTopWidth: 1,
    borderTopColor: COLOR_INK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
  },
  footerSeq: {
    fontFamily: 'Space Mono',
    fontWeight: 700,
    fontSize: 8,
    letterSpacing: 1.6,
    color: COLOR_INK,
  },
  footerBrand: {
    fontFamily: 'Space Mono',
    fontWeight: 700,
    fontSize: 8,
    letterSpacing: 1.6,
    color: COLOR_MUTE,
  },
});

function TicketPage({data}: {data: TicketPdfData}) {
  const titleLines = fitTitleLines(data.eventTitle);
  const attendee = fitAttendeeName(data.attendeeName);
  const {weekday, isoDate, time} = formatTicketDateParts(data.eventDate);
  const code = shortTicketCode(data.ticketId);

  return (
    <Page size="A4" style={s.page}>
      <View style={s.frame}>
        <View style={s.topBand}>
          <View style={s.topBandPair}>
            <Text style={s.topBandKey}>EVENT ·</Text>
            <Text style={s.topBandValue}>
              {isoDate} · {weekday}
            </Text>
          </View>
          <View style={s.topBandPair}>
            <Text style={s.topBandKey}>DOORS ·</Text>
            <Text style={s.topBandValue}>{time}</Text>
          </View>
        </View>

        <View style={s.hero}>
          <View style={s.heroKickerRow}>
            <View style={s.heroKickerMark} />
            <Text style={s.heroKicker}>{data.promoterName.toUpperCase()}</Text>
          </View>
          {titleLines.map((line, i) => (
            <Text
              key={i}
              style={[
                s.titleLine,
                {
                  fontSize: line.fontSize,
                  letterSpacing: line.letterSpacing,
                  lineHeight: line.lineHeight,
                },
              ]}
            >
              {line.text}
            </Text>
          ))}
          <View style={s.titleAccent} />
        </View>

        <View style={s.perforation} />

        <View style={s.qrZone}>
          <View style={s.holderBlock}>
            {attendee.lines.map((line, i) => (
              <Text
                key={i}
                style={[
                  s.attendeeDisplay,
                  {
                    fontSize: attendee.fontSize,
                    letterSpacing: attendee.letterSpacing,
                    lineHeight: attendee.lineHeight,
                  },
                ]}
              >
                {line}
              </Text>
            ))}
            {data.location ? (
              <Text style={s.venueLine}>{data.location.toUpperCase()}</Text>
            ) : null}
          </View>
          <View style={s.qrPanel}>
            <Image src={data.qrCodeDataUrl} style={s.qrImage} />
          </View>
        </View>

        <View style={s.footer}>
          <Text style={s.footerSeq}>{code}</Text>
          <Text style={s.footerBrand}>BRAKET TICKETS</Text>
        </View>
      </View>
    </Page>
  );
}

function TicketDocument({tickets}: {tickets: TicketPdfData[]}) {
  return (
    <Document>
      {tickets.map((t) => (
        <TicketPage key={t.ticketId} data={t} />
      ))}
    </Document>
  );
}

async function renderToBase64DataUrl(
  tickets: TicketPdfData[],
): Promise<string> {
  const instance = pdf(<TicketDocument tickets={tickets} />);
  const result = await instance.toBuffer();
  const buffer = Buffer.isBuffer(result)
    ? result
    : await streamToBuffer(result);
  return `data:application/pdf;base64,${buffer.toString('base64')}`;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function createTicketPdf(data: TicketPdfData): Promise<string> {
  return renderToBase64DataUrl([data]);
}

export async function createTicketBundlePdf(
  tickets: TicketPdfData[],
): Promise<string> {
  return renderToBase64DataUrl(tickets);
}
