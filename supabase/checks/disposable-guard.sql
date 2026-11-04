\if :{?money_saver_disposable_project_ref}
\else
\echo 'Refusing execution without the disposable-project runner.'
\quit 3
\endif
select (:'money_saver_disposable_project_ref' ~ '^[a-z]{20}$'
  and :'money_saver_disposable_project_ref' <> 'iwzmsbkbuerleocismhj') as disposable_target_allowed \gset
\if :disposable_target_allowed
\else
\echo 'Production or invalid target refused.'
\quit 3
\endif
