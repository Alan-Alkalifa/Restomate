begin;
select plan(1);
select ok(false, 'deliberate failure: CI must go red');
select * from finish();
rollback;
