-- Audit checklist v2: replace the 18 migration-detail audit items with the
-- 6 Audit File Status items. Safe to re-run. Run in the Supabase SQL editor.
begin;

delete from task_notes where task_id in (
  select t.id from tasks t
  join task_templates tt on tt.id = t.template_id
  where tt.phase = 'audit');

delete from tasks where template_id in (
  select id from task_templates where phase = 'audit');

delete from task_templates where phase = 'audit';

insert into task_templates (name, phase, sort_order) values
  ('Census Audit','audit',1),
  ('Withholding Audit','audit',2),
  ('Payment Audit','audit',3),
  ('Prior Payroll Audit','audit',4),
  ('Deduction Audit','audit',5),
  ('Emergency Contact Audit','audit',6);

-- backfill the new audit tasks for any client that already exists
insert into tasks (client_id, template_id, title)
select c.id, t.id, t.name
from clients c cross join task_templates t
where t.phase = 'audit'
  and not exists (select 1 from tasks x
                  where x.client_id = c.id and x.template_id = t.id);

commit;
