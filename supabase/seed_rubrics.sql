-- Calibrated rubrics from rubric.txt (8 past hires). Idempotent.
insert into public.kargo_rubrics (role, title, threshold, lower_tier_below, criteria, scale, notes) values
('PM', 'Product Manager', 65, 45,
 $j$[
  {"key":"logistics_ops","name":"Ground-level logistics/ops exposure","weight":25,
   "guidance":"Look for: roles inside freight forwarding, customs brokerage (CHA), port operations, carrier/3PL, or supply-chain/logistics planning. Adjacent SaaS-for-logistics roles (e.g., selling to or integrating with logistics companies) score lower than roles actually performed inside a logistics operation."},
  {"key":"self_initiated_build","name":"Self-initiated build adopted unprompted","weight":25,
   "guidance":"Look for: language like \"identified,\" \"built a prototype,\" \"no one asked me to,\" followed by evidence of organic adoption (\"adopted by X colleagues/teams,\" \"became permanent process,\" \"became the standard\"). Distinguish this from features/tools built as an assigned part of the job."},
  {"key":"crisis_ownership","name":"Owns a crisis to resolution, no escalation","weight":20,
   "guidance":"Look for: a specific high-stakes incident (outage, compliance audit, urgent client issue, critical bug) that the candidate personally resolved end-to-end, ideally with a timeframe (\"same day,\" \"overnight,\" \"within 3 hours\") and without mention of escalating to a manager."},
  {"key":"ship_and_kill","name":"Shipped and killed features with evidence","weight":15,
   "guidance":"Look for: specific features shipped, usage/adoption data cited, and — critically — evidence of killing something that didn't work based on data, not just shipping."},
  {"key":"structure_from_zero","name":"Comfort building structure from zero","weight":15,
   "guidance":"Look for: evidence of operating without existing playbooks, templates, or process, and building the first version of something (a PRD template, sprint process, a product function) rather than joining an existing one."}
 ]$j$::jsonb,
 $j${"5":"Strong, specific, evidenced multiple times in the CV","4":"Clear evidence, at least one strong instance","3":"Some evidence, but partial or single instance","2":"Weak or indirect/adjacent evidence only","1":"No evidence in the CV"}$j$::jsonb,
 'Reference threshold: PM candidates scoring 65+ resemble Kargo''s strongest past hires. Candidates scoring below ~45 resemble hires who did not exceed expectations. Calibration: Lavanya Iyer 100, Rohan Desai 91, Sunita Krishnamurthy 88, Meghna Tiwari 88, Aditya Shetty 68 (Exceeds); Vikram Nair 44 (Meets); Preetham Rao 41 (Below); Rahul Bose 39 (Meets).'),
('SPM', 'Senior Product Manager', 60, null,
 $j$[
  {"key":"high_stakes_ownership","name":"Owns high-stakes/hard-to-undo situations end-to-end","weight":25,
   "guidance":"Look for: a decision or incident with consequences that are difficult to reverse (an outage, an audit, a client escalation with real revenue/reputation risk), owned personally from start to close, without a committee or manager approving the call."},
  {"key":"logistics_ops","name":"Ground-level logistics/ops exposure","weight":20,
   "guidance":"Same evidence bar as the PM rubric, criterion 1: roles inside freight forwarding, customs brokerage (CHA), port operations, carrier/3PL, or supply-chain/logistics planning. Adjacent SaaS-for-logistics roles (e.g., selling to or integrating with logistics companies) score lower than roles actually performed inside a logistics operation."},
  {"key":"self_initiated_build_scope","name":"Self-initiated build adopted, increasing scope","weight":25,
   "guidance":"Same as PM rubric criterion 2 (noticed a gap nobody assigned, built the fix unprompted, organically adopted — not an assigned deliverable), but score higher when the thing built was adopted beyond the candidate's own immediate team (e.g., \"adopted by 2 other regional teams,\" \"became company-wide standard\") rather than just their own team."},
  {"key":"integration_complexity","name":"Integration/platform/data complexity in ambiguous environments","weight":15,
   "guidance":"Look for: work on integration layers, platform architecture, data pipelines, or systems that had to work inside complex existing technical environments (multiple third-party systems, legacy vendors, cross-system data flow). Note: in calibration, this criterion alone did not reliably separate Exceeds from Below hires — a supporting signal, not a primary one."},
  {"key":"institutionalizes_standards","name":"Institutionalizes standards others adopt after them","weight":15,
   "guidance":"Look for: evidence that the candidate defined a practice, framework, or standard (a scorecard methodology, onboarding framework, review process) that continued to be used by others after the candidate moved on or that was adopted by other teams."}
 ]$j$::jsonb,
 $j${"5":"Strong, specific, evidenced multiple times in the CV","4":"Clear evidence, at least one strong instance","3":"Some evidence, but partial or single instance","2":"Weak or indirect/adjacent evidence only","1":"No evidence in the CV"}$j$::jsonb,
 'Reference threshold: SPM candidates scoring 60+ resemble Kargo''s strongest past hires. Calibration: Lavanya Iyer 97, Rohan Desai 94, Sunita Krishnamurthy 86, Meghna Tiwari 83, Aditya Shetty 63 (Exceeds); Preetham Rao 51 (Below); Vikram Nair 39 (Meets); Rahul Bose 36 (Meets). KNOWN LIMITATION: this rubric reliably separates Exceeds from did-not-exceed, but should not be treated as a precise ranking within the lower tier. Arjun''s own review of the shortlist remains the final check.')
on conflict (role) do update set title=excluded.title, threshold=excluded.threshold, lower_tier_below=excluded.lower_tier_below,
  criteria=excluded.criteria, scale=excluded.scale, notes=excluded.notes, updated_at=now();
