// ─── Mock Project Contacts ───────────────────────────────────────────────────
// Building/external contacts captured during pre-flight checklist.

export interface ProjectContact {
  id: string;
  project_id: string;
  name: string;
  position: string;
  phone: string;
  email: string;
}

const mockContacts: ProjectContact[] = [
  // 31-107
  { id: 'pc-038', project_id: '31-107', name: 'Tyler Brooks', position: 'Architect', phone: '(404) 555-0101', email: 'tbrooks@archvision.example' },
  { id: 'pc-039', project_id: '31-107', name: 'Natalie Kim', position: 'Building Manager', phone: '(404) 555-0102', email: 'nkim@q7metro.example' },
  { id: 'pc-040', project_id: '31-107', name: 'Derek Owens', position: 'Building Engineer', phone: '(404) 555-0103', email: 'dowens@engpro.example' },

  // 31-112
  { id: 'pc-041', project_id: '31-112', name: 'Samantha Pierce', position: 'Architect', phone: '(770) 555-0201', email: 'spierce@piercedesign.example' },
  { id: 'pc-042', project_id: '31-112', name: 'Anthony Ruiz', position: 'Construction Manager', phone: '(770) 555-0202', email: 'aruiz@buildgroup.example' },
  { id: 'pc-043', project_id: '31-112', name: 'Karen Mitchell', position: 'Building Manager', phone: '(770) 555-0203', email: 'kmitchell@duluthtc.example' },
  { id: 'pc-044', project_id: '31-112', name: 'Brandon Hayes', position: 'Building Engineer', phone: '(770) 555-0204', email: 'bhayes@engworks.example' },

  // 31-118
  { id: 'pc-001', project_id: '31-118', name: 'Michael Chen', position: 'Architect', phone: '(404) 555-1201', email: 'mchen@smitharch.example' },
  { id: 'pc-002', project_id: '31-118', name: 'Sarah Williams', position: 'Construction Manager', phone: '(404) 555-1202', email: 'swilliams@buildfirm.example' },
  { id: 'pc-003', project_id: '31-118', name: 'Robert Davis', position: 'Building Manager', phone: '(404) 555-1203', email: 'rdavis@property.example' },
  { id: 'pc-004', project_id: '31-118', name: 'James Wilson', position: 'Building Engineer', phone: '(404) 555-1204', email: 'jwilson@property.example' },
  { id: 'pc-005', project_id: '31-118', name: 'Maria Garcia', position: 'Building Security', phone: '(404) 555-1205', email: 'mgarcia@secureco.example' },

  // 31-121
  { id: 'pc-006', project_id: '31-121', name: 'Lisa Park', position: 'Architect', phone: '(770) 555-2301', email: 'lpark@designstudio.example' },
  { id: 'pc-007', project_id: '31-121', name: 'Tom Bradley', position: 'Construction Manager', phone: '(770) 555-2302', email: 'tbradley@cmgroup.example' },
  { id: 'pc-008', project_id: '31-121', name: 'Nancy Thompson', position: 'Building Manager', phone: '(770) 555-2303', email: 'nthompson@mgmt.example' },
  { id: 'pc-009', project_id: '31-121', name: 'Kevin Lee', position: 'Building Engineer', phone: '(770) 555-2304', email: 'klee@engservices.example' },
  { id: 'pc-010', project_id: '31-121', name: 'Carlos Mendez', position: 'Building Security', phone: '(770) 555-2305', email: 'cmendez@securityco.example' },

  // 31-126
  { id: 'pc-011', project_id: '31-126', name: 'Amy Foster', position: 'Architect', phone: '(678) 555-3401', email: 'afoster@archdesign.example' },
  { id: 'pc-012', project_id: '31-126', name: 'David Kim', position: 'Building Manager', phone: '(678) 555-3403', email: 'dkim@bldgops.example' },
  { id: 'pc-013', project_id: '31-126', name: 'Patricia Ross', position: 'Building Engineer', phone: '(678) 555-3404', email: 'pross@engfirm.example' },
  { id: 'pc-014', project_id: '31-126', name: 'John Martinez', position: 'Building Security', phone: '(678) 555-3405', email: 'jmartinez@guardsvc.example' },

  // 31-130
  { id: 'pc-015', project_id: '31-130', name: 'Rebecca Turner', position: 'Architect', phone: '(404) 555-4501', email: 'rturner@archgroup.example' },
  { id: 'pc-016', project_id: '31-130', name: 'Paul Anderson', position: 'Construction Manager', phone: '(404) 555-4502', email: 'panderson@construct.example' },
  { id: 'pc-017', project_id: '31-130', name: 'Diana Price', position: 'Building Manager', phone: '(404) 555-4503', email: 'dprice@realty.example' },
  { id: 'pc-018', project_id: '31-130', name: 'Steve Miller', position: 'Building Engineer', phone: '(404) 555-4504', email: 'smiller@engco.example' },
  { id: 'pc-019', project_id: '31-130', name: 'Angela White', position: 'Building Security', phone: '(404) 555-4505', email: 'awhite@securitypro.example' },

  // 31-133
  { id: 'pc-020', project_id: '31-133', name: 'Jason Clark', position: 'Architect', phone: '(770) 555-5601', email: 'jclark@archstudio.example' },
  { id: 'pc-021', project_id: '31-133', name: 'Helen Brown', position: 'Building Manager', phone: '(770) 555-5603', email: 'hbrown@bldgmgmt.example' },
  { id: 'pc-022', project_id: '31-133', name: 'Mark Evans', position: 'Building Engineer', phone: '(770) 555-5604', email: 'mevans@engserv.example' },
  { id: 'pc-023', project_id: '31-133', name: 'Sandra Lopez', position: 'Building Security', phone: '(770) 555-5605', email: 'slopez@guardforce.example' },

  // 31-137
  { id: 'pc-024', project_id: '31-137', name: 'Brian Taylor', position: 'Architect', phone: '(678) 555-6701', email: 'btaylor@dt-arch.example' },
  { id: 'pc-025', project_id: '31-137', name: 'Wendy Scott', position: 'Construction Manager', phone: '(678) 555-6702', email: 'wscott@cmpartners.example' },
  { id: 'pc-026', project_id: '31-137', name: 'Greg Harris', position: 'Building Manager', phone: '(678) 555-6703', email: 'gharris@propmgmt.example' },
  { id: 'pc-027', project_id: '31-137', name: 'Laura Adams', position: 'Building Engineer', phone: '(678) 555-6704', email: 'ladams@engworks.example' },
  { id: 'pc-028', project_id: '31-137', name: 'Frank Nguyen', position: 'Building Security', phone: '(678) 555-6705', email: 'fnguyen@secservices.example' },

  // 31-140
  { id: 'pc-029', project_id: '31-140', name: 'Christine Reynolds', position: 'Architect', phone: '(404) 555-7801', email: 'creynolds@arcinc.example' },
  { id: 'pc-030', project_id: '31-140', name: 'Daniel Moore', position: 'Building Manager', phone: '(404) 555-7803', email: 'dmoore@bldgservices.example' },
  { id: 'pc-031', project_id: '31-140', name: 'Rachel Green', position: 'Building Engineer', phone: '(404) 555-7804', email: 'rgreen@engconsult.example' },
  { id: 'pc-032', project_id: '31-140', name: 'Tony Russo', position: 'Building Security', phone: '(404) 555-7805', email: 'trusso@securityteam.example' },

  // 31-144
  { id: 'pc-033', project_id: '31-144', name: 'Megan Campbell', position: 'Architect', phone: '(770) 555-8901', email: 'mcampbell@designarch.example' },
  { id: 'pc-034', project_id: '31-144', name: 'Victor Patel', position: 'Construction Manager', phone: '(770) 555-8902', email: 'vpatel@cmservices.example' },
  { id: 'pc-035', project_id: '31-144', name: 'Dorothy Walker', position: 'Building Manager', phone: '(770) 555-8903', email: 'dwalker@facilityco.example' },
  { id: 'pc-036', project_id: '31-144', name: 'Ryan Cooper', position: 'Building Engineer', phone: '(770) 555-8904', email: 'rcooper@buildeng.example' },
  { id: 'pc-037', project_id: '31-144', name: 'Erica Simmons', position: 'Building Security', phone: '(770) 555-8905', email: 'esimmons@guardsolutions.example' },
];

export function getProjectContacts(projectId: string): ProjectContact[] {
  return mockContacts.filter((c) => c.project_id === projectId);
}
