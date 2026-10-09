-- Cap member name length (defense in depth behind the input maxLength and
-- the trip-auth / addMember validations, which both enforce <= 40 chars).
alter table members
  add constraint members_name_length
  check (char_length(name) >= 1 and char_length(name) <= 40);
