-- Keep new laboratory classifications consistent without changing prior approved reports.
create function private.validate_lab_category_grade()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.process not in ('Washed', 'Natural', 'UG') then
      raise exception 'Choose Washed, Natural, or UG as the coffee category.';
    end if;
  else
    if new.process is distinct from old.process and new.process not in ('Washed', 'Natural', 'UG') then
      raise exception 'Choose Washed, Natural, or UG as the coffee category.';
    end if;
    -- Preserve old snapshots and let an older draft be reopened before choosing a current grade.
    if new.process is not distinct from old.process
      and new.proposed_grade is not distinct from old.proposed_grade
      and not (new.status = 'SUBMITTED' and old.status is distinct from new.status) then
      return new;
    end if;
  end if;

  if new.proposed_grade is not null and
    ((new.process = 'UG' and new.proposed_grade <> 'UG') or
     (new.process in ('Washed', 'Natural') and
       new.proposed_grade not in ('Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'))) then
    raise exception 'Choose a grade allowed for this coffee category.';
  end if;
  return new;
end; $$;

create trigger lab_samples_category_grade_guard
before insert or update of process, proposed_grade, status on public.lab_samples
for each row execute function private.validate_lab_category_grade();

revoke all on function private.validate_lab_category_grade() from public, anon, authenticated;
