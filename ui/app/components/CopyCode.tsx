import React, { useState } from "react";
import { CodeSnippet } from "@dynatrace/strato-components/content";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Paragraph } from "@dynatrace/strato-components/typography";
import { RESOLVE_NOTE, SNIPPETS } from "./snippets";

/** "Send an event" snippets in tabs, one shared constant for Integrations and Help (DESIGN §10.1). */
export const SendEventSnippets = () => {
  const [tab, setTab] = useState(0);
  return (
    <Flex flexDirection="column" gap={8}>
      <Tabs selectedIndex={tab} onChange={setTab}>
        {SNIPPETS.map((s) => (
          <Tab key={s.id} title={s.label}>
            <Flex paddingTop={8} flexDirection="column">
              <CodeSnippet language={s.language} showLineNumbers={false}>
                {s.code}
              </CodeSnippet>
            </Flex>
          </Tab>
        ))}
      </Tabs>
      <Paragraph>{RESOLVE_NOTE}</Paragraph>
    </Flex>
  );
};
