/**
 * Help: the app's documentation.
 *
 * Without `?doc=` it shows the overview (the self-ticking Get started checklist, concepts, event snippets, shortcuts,
 * troubleshooting); the Help menu links to its sections by `#id`. With `?doc=<guide>` it shows one of the six user
 * guides, generated from the markdown in docs/guides/en (English) and guides/{pt-BR,es} (scripts/gen-help-content.mjs)
 * and loaded lazily per language. `?lang=` makes a link open in the language it was shared in (guides/language.ts).
 * The overview is translated too (overview.ts): whatever the selector shows is the language of everything below it.
 */
import React, { useEffect, useState } from "react";
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Flex, Grid, PageLayout, Surface } from "@dynatrace/strato-components/layouts";
import { CodeSnippet, KeyboardShortcut, Markdown, MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import { Tab, Tabs } from "@dynatrace/strato-components/navigation";
import { FormField, Label, Select } from "@dynatrace/strato-components/forms";
import { SimpleTable } from "@dynatrace/strato-components/tables";
import { Heading, Link, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { CircleIcon, SuccessIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { useAppData } from "../../hooks/AppDataContext";
import { PageTitle } from "../../components/PageTitle";
import { EVENT_FIELDS, SNIPPETS, TOKEN_SCOPE } from "../../components/snippets";
import { teamReadiness } from "../teams/readiness";
import { GuideView } from "./GuideView";
import { GUIDE_IDS, isGuideId, LANGUAGES, type GuideId, type GuideSet, type Language } from "./guides/content";
import { helpHref, LABELS, LANGUAGE_NAMES, languageSwitchHref, loadGuides, readStoredLanguage, resolveLanguage, storeLanguage } from "./guides/language";
import { OVERVIEW, SHORTCUT_KEYS, TOC_IDS, type OverviewText } from "./overview";

const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <Flex flexDirection="column" gap={12} id={id}>
    <Heading level={2}>{title}</Heading>
    {children}
  </Flex>
);

/**
 * The "send an event" snippets of Integrations (components/snippets.ts) with the notes in the reader's language. The
 * code itself is the same in every language.
 */
const EventSnippets = ({ text }: { text: OverviewText }) => {
  const [tab, setTab] = useState(0);
  return (
    <Flex flexDirection="column" gap={8}>
      <Tabs selectedIndex={tab} onChange={setTab}>
        {SNIPPETS.map((s) => (
          <Tab key={s.id} title={s.language === "javascript" ? text.workflowSnippet : s.label}>
            <Flex paddingTop={8} flexDirection="column">
              <CodeSnippet language={s.language} showLineNumbers={false}>
                {s.code}
              </CodeSnippet>
            </Flex>
          </Tab>
        ))}
      </Tabs>
      <Paragraph>{text.resolveNote}</Paragraph>
      <Paragraph>{text.eventSourceNote}</Paragraph>
    </Flex>
  );
};

/** Loads one language's guides lazily; `undefined` while loading, `null` when the chunk failed to load. */
function useGuides(lang: Language, wanted: boolean): GuideSet | null | undefined {
  const [state, setState] = useState<{ lang: Language; guides: GuideSet | null } | undefined>();
  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    loadGuides(lang).then(
      (guides) => alive && setState({ lang, guides }),
      () => alive && setState({ lang, guides: null }),
    );
    return () => {
      alive = false;
    };
  }, [lang, wanted]);
  return state?.lang === lang ? state.guides : undefined;
}

export const HelpPage = () => {
  const { data, userName } = useAppData();
  const location = useLocation();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const docParam = search.get("doc");
  const doc: GuideId | undefined = isGuideId(docParam) ? docParam : undefined;
  // One language for the whole page, derived from the URL (or the remembered choice) on every render, never copied
  // into state: the selector, the labels, the overview and the guide can never disagree.
  const lang = resolveLanguage({ query: search.get("lang"), stored: readStoredLanguage() });
  const labels = LABELS[lang];
  const text = OVERVIEW[lang];
  const guides = useGuides(lang, !!doc);
  const guide = doc && guides ? guides[doc] : undefined;

  // Scroll to the anchor once the content is there (a guide arrives after its chunk loads); a new guide without an
  // anchor starts at the top. Accented anchors (#passo-2--entenda-as-permissões) arrive percent-encoded.
  useEffect(() => {
    let id = location.hash.replace(/^#/, "");
    try {
      id = decodeURIComponent(id);
    } catch {
      // malformed escape: use it as is
    }
    if (doc && !guide) return;
    const target = id ? document.getElementById(id) : document.getElementById("help-top");
    if (target) window.setTimeout(() => target.scrollIntoView({ behavior: id ? "smooth" : "auto", block: "start" }), 100);
  }, [location.hash, doc, guide]);

  const chooseLanguage = (next: Language | null) => {
    const href = languageSwitchHref(lang, next, doc, location.hash);
    if (!href || !next) return;
    storeLanguage(next);
    navigate(href, { replace: true });
  };

  // The team steps (people, contacts, schedule, policy, routing) live in the team's own checklist: one link here.
  const teams = data?.teams ?? [];
  const readyTeam = data ? teams.find((t) => teamReadiness(t, data, userName).every((i) => i.done)) : undefined;
  const openTeam = readyTeam ?? teams[0];
  const steps = [
    { done: teams.length > 0, label: text.steps[0], to: teams.length ? "/teams" : "/teams?new=1" },
    { done: !!readyTeam, label: text.steps[1], to: openTeam ? `/teams/${openTeam.id}` : "/teams" },
    { done: !!data?.settings.providers.some((p) => p.enabled), label: text.steps[2], to: "/integrations?tab=outbound" },
    { done: !!data?.heartbeat, label: text.steps[3], to: "/integrations?tab=workflows" },
    { done: (data?.incidents.length ?? 0) > 0, label: text.steps[4], to: "/integrations" },
  ];

  return (
    <PageLayout.Content>
      <Flex id="help-top" flexDirection="column" gap={16} padding={16} style={{ maxWidth: 1200, margin: "0 auto", width: "100%" }}>
        <PageTitle title={text.title} subtitle={text.subtitle} />
        <Grid gridTemplateColumns="220px minmax(0, 960px)" gap={32}>
          <Flex flexDirection="column" gap={8} style={{ position: "sticky", top: 16, alignSelf: "start" }}>
            <FormField>
              <Label>{labels.language}</Label>
              <Select<Language> value={lang} onChange={chooseLanguage}>
                <Select.Content>
                  {LANGUAGES.map((l) => (
                    <Select.Option key={l} value={l}>
                      {LANGUAGE_NAMES[l]}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            </FormField>
            <Link as={RouterLink} to={helpHref(lang)}>
              {doc ? labels.overview : <Text textStyle="base-emphasized">{labels.overview}</Text>}
            </Link>
            {!doc &&
              TOC_IDS.map((id) => (
                <Flex key={id} paddingLeft={12}>
                  <Link as={RouterLink} to={helpHref(lang, undefined, id)}>
                    {text.sections[id]}
                  </Link>
                </Flex>
              ))}
            <Text textStyle="small-emphasized">{labels.guides}</Text>
            {GUIDE_IDS.map((id) => (
              <Flex key={id} flexDirection="column" gap={4}>
                <Link as={RouterLink} to={helpHref(lang, id)} aria-current={id === doc ? "page" : undefined}>
                  {id === doc ? <Text textStyle="base-emphasized">{labels.guideNames[id]}</Text> : labels.guideNames[id]}
                </Link>
                {id === doc && guide && (
                  <Flex flexDirection="column" gap={4} paddingLeft={12} aria-label={labels.onThisPage}>
                    {guide.headings
                      .filter((h) => h.depth === 2)
                      .map((h) => (
                        <Link key={h.slug} as={RouterLink} to={helpHref(lang, id, h.slug)}>
                          <Text textStyle="small">{h.text}</Text>
                        </Link>
                      ))}
                  </Flex>
                )}
              </Flex>
            ))}
          </Flex>
          {doc ? (
            guide ? (
              <GuideView key={`${lang}:${guide.id}`} guide={guide} lang={lang} />
            ) : guides === null ? (
              <MessageContainer variant="critical">
                <MessageContainer.Description>{labels.loadFailed}</MessageContainer.Description>
              </MessageContainer>
            ) : (
              <Flex justifyContent="center" padding={32}>
                <ProgressCircle aria-label={labels.loading} />
              </Flex>
            )
          ) : (
            <Flex flexDirection="column" gap={32}>
              <Section id="get-started" title={text.sections["get-started"]}>
                <Paragraph>{text.getStartedIntro}</Paragraph>
                <Surface padding={16}>
                  <Flex flexDirection="column" gap={12}>
                    {steps.map((s, i) => (
                      <Flex key={s.to + i} gap={12} alignItems="center">
                        {s.done ? (
                          <SuccessIcon style={{ color: Colors.Icon.Success.Default }} aria-label={text.done} />
                        ) : (
                          <CircleIcon style={{ color: Colors.Icon.Neutral.Subdued }} aria-label={text.toDo} />
                        )}
                        <Text textStyle="base-emphasized">{i + 1}.</Text>
                        <Link as={RouterLink} to={s.to}>
                          {s.label}
                        </Link>
                      </Flex>
                    ))}
                  </Flex>
                </Surface>
              </Section>
              <Section id="concepts" title={text.sections.concepts}>
                <Markdown>{text.concepts}</Markdown>
              </Section>
              <Section id="console" title={text.sections.console}>
                <Markdown>{text.console}</Markdown>
              </Section>
              <Section id="inbound" title={text.sections.inbound}>
                <Paragraph>
                  {text.inbound[0]} {TOKEN_SCOPE}
                  {text.inbound[1]}
                </Paragraph>
                <EventSnippets text={text} />
                <SimpleTable
                  data={EVENT_FIELDS.map((f) => ({ field: f.field, usedFor: f.field in text.eventFields ? text.eventFields[f.field as keyof OverviewText["eventFields"]] : f.usedFor }))}
                  columns={[
                    { id: "field", header: text.fieldHeader, accessor: "field", width: 240 },
                    { id: "usedFor", header: text.usedForHeader, accessor: "usedFor", width: 520 },
                  ]}
                />
              </Section>
              <Section id="outbound" title={text.sections.outbound}>
                <Markdown>{text.outbound}</Markdown>
              </Section>
              <Section id="shortcuts" title={text.sections.shortcuts}>
                <Paragraph>{text.shortcutsIntro}</Paragraph>
                <Flex flexDirection="column" gap={8}>
                  {SHORTCUT_KEYS.map((keys) => (
                    <Flex key={keys} gap={16} alignItems="center">
                      <Flex style={{ width: 120 }}>
                        <KeyboardShortcut keys={keys} />
                      </Flex>
                      <Text>{text.shortcuts[keys]}</Text>
                    </Flex>
                  ))}
                </Flex>
              </Section>
              <Section id="troubleshooting" title={text.sections.troubleshooting}>
                <Markdown>{text.troubleshooting}</Markdown>
              </Section>
              <Section id="privacy" title={text.sections.privacy}>
                <Markdown>{text.privacy}</Markdown>
              </Section>
            </Flex>
          )}
        </Grid>
      </Flex>
    </PageLayout.Content>
  );
};
