from .model import *
DEMO_MODEL = ProcessModel(
 id='trade-exception-demo', name='Trade Exception Resolution', start_activity='intake', end_activity='complete', arrival_rate_per_hour=8.0, sla_minutes=360.0,
 activities=[
  Activity(id='intake',name='Intake',resource_pool='ops',service_time=ServiceTime(mean_minutes=8,std_minutes=2),cost_per_hour=55),
  Activity(id='validate',name='Validate',resource_pool='ops',service_time=ServiceTime(mean_minutes=18,std_minutes=6),cost_per_hour=55),
  Activity(id='review',name='Analyst Review',resource_pool='analyst',service_time=ServiceTime(mean_minutes=42,std_minutes=15),cost_per_hour=85),
  Activity(id='exception',name='Exception Handling',resource_pool='senior',service_time=ServiceTime(mean_minutes=70,std_minutes=25),cost_per_hour=125),
  Activity(id='qa',name='Quality Check',resource_pool='qa',service_time=ServiceTime(mean_minutes=20,std_minutes=8),cost_per_hour=75),
  Activity(id='complete',name='Complete',service_time=ServiceTime(distribution='constant',mean_minutes=1,std_minutes=0),cost_per_hour=0),
 ],
 resources=[ResourcePool(id='ops',name='Operations',capacity=5),ResourcePool(id='analyst',name='Analysts',capacity=7),ResourcePool(id='senior',name='Senior Analysts',capacity=2),ResourcePool(id='qa',name='Quality',capacity=2)],
 architectures=[
  Architecture(id='baseline',name='Baseline',enabled_activities=['intake','validate','review','exception','qa','complete'],transitions=[Transition(source='intake',target='validate'),Transition(source='validate',target='review',probability=.78),Transition(source='validate',target='exception',probability=.22),Transition(source='exception',target='review'),Transition(source='review',target='qa'),Transition(source='qa',target='complete',probability=.92),Transition(source='qa',target='review',probability=.08)]),
  Architecture(id='straight_through',name='Straight-through + Exception Cell',enabled_activities=['intake','validate','review','exception','qa','complete'],transitions=[Transition(source='intake',target='validate'),Transition(source='validate',target='review',probability=.88),Transition(source='validate',target='exception',probability=.12),Transition(source='exception',target='review'),Transition(source='review',target='qa'),Transition(source='qa',target='complete',probability=.96),Transition(source='qa',target='review',probability=.04)])
 ],
 variables=[
  DesignVariable(name='analyst_capacity',kind='quantized',lower=4,upper=12,step=1,value=7),
  DesignVariable(name='senior_capacity',kind='quantized',lower=1,upper=5,step=1,value=2),
  DesignVariable(name='qa_capacity',kind='quantized',lower=1,upper=5,step=1,value=2),
  DesignVariable(name='automation_level',kind='continuous',lower=0,upper=.8,value=.15),
  DesignVariable(name='qa_rework_rate',kind='continuous',lower=.01,upper=.15,value=.08),
  DesignVariable(name='architecture',kind='discrete',choices=['baseline','straight_through'],value='baseline')
 ])
