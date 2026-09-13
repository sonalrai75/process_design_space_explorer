from collections import Counter,defaultdict
import pandas as pd, numpy as np
REQ={'case_id','activity','start_time','end_time'}
def normalize_log(df):
    missing=REQ-set(df.columns)
    if missing: raise ValueError(f'Missing columns: {sorted(missing)}')
    out=df.copy(); out['start_time']=pd.to_datetime(out['start_time'],utc=True,format='mixed'); out['end_time']=pd.to_datetime(out['end_time'],utc=True,format='mixed')
    out['duration_min']=(out['end_time']-out['start_time']).dt.total_seconds()/60
    return out.sort_values(['case_id','start_time','end_time'])
def mine_log(df):
    df=normalize_log(df); trans=Counter(); cycles=[]; repeats=0
    for _,g in df.groupby('case_id',sort=False):
        a=g.activity.tolist(); repeats+=len(a)-len(set(a)); trans.update(zip(a[:-1],a[1:])); cycles.append((g.end_time.max()-g.start_time.min()).total_seconds()/60)
    outgoing=defaultdict(int)
    for (a,b),n in trans.items(): outgoing[a]+=n
    starts=df.groupby('case_id').start_time.min().sort_values(); diffs=starts.diff().dropna().dt.total_seconds()/3600
    arr=(1/float(diffs.mean())) if len(diffs) and diffs.mean()>0 else None
    return {'cases':int(df.case_id.nunique()),'events':int(len(df)),'activities':sorted(df.activity.astype(str).unique().tolist()),
      'service_times':df.groupby('activity').duration_min.agg(['count','mean','std','median']).fillna(0).reset_index().to_dict('records'),
      'transitions':[{'source':a,'target':b,'count':n,'probability':n/outgoing[a]} for (a,b),n in trans.items()],
      'arrival_rate_per_hour':arr,'mean_case_cycle_minutes':float(np.mean(cycles)),'p95_case_cycle_minutes':float(np.percentile(cycles,95)),
      'repeat_event_rate':float(repeats/max(len(df),1))}
def compare_mined_logs(a,b):
    x,y=mine_log(a),mine_log(b)
    return {'actual':x,'simulated':y,'delta':{'mean_cycle':(y['mean_case_cycle_minutes']-x['mean_case_cycle_minutes'])/x['mean_case_cycle_minutes'],'p95_cycle':(y['p95_case_cycle_minutes']-x['p95_case_cycle_minutes'])/x['p95_case_cycle_minutes'],'repeat_event_rate':y['repeat_event_rate']-x['repeat_event_rate']}}
