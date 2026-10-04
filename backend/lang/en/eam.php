<?php

return [
    'status' => [
        'active' => 'Active',
        'in_storage' => 'In storage',
        'in_repair' => 'In repair',
        'lost' => 'Lost',
        'disposed' => 'Disposed',
    ],
    'movement_type' => [
        'registered' => 'Registered',
        'transfer' => 'Transfer',
    ],
    'movement' => [
        'nothing_to_change' => 'Please specify a location or custodian to transfer to.',
        'no_change' => 'Location and custodian are unchanged; nothing to transfer.',
        'future_date' => 'The transfer date cannot be in the future.',
    ],
    'location' => [
        'has_children' => 'Cannot delete: this location still has sub-locations. Move or delete them first.',
        'has_assets' => 'Cannot delete: assets are still assigned here. Move them out first or deactivate the location instead.',
        'invalid_parent' => 'The parent location cannot be itself or one of its sub-locations.',
        'code_format' => 'Location code may only contain A-Z, 0-9, - _ /',
    ],
    'user' => [
        'self_lock' => 'You cannot demote or deactivate your own account.',
        'self_delete' => 'You cannot delete your own account.',
        'has_history' => 'Cannot delete: this user has history (assets held/created or transfers). Deactivate the account instead.',
    ],
    'auth' => [
        'failed' => 'Invalid email or password.',
    ],
    'branch' => [
        'in_use' => 'Cannot delete: users or tickets still belong to this branch. Deactivate it instead.',
    ],
    'ticket_type' => [
        'repair' => 'Repair',
        'install' => 'Installation',
        'grant_access' => 'Grant access',
        'revoke_access' => 'Revoke access',
        'other' => 'Other',
    ],
    'ticket_status' => [
        'pending_supervisor' => 'Awaiting supervisor',
        'approved' => 'Awaiting IT',
        'in_progress' => 'In progress',
        'pending_it_head' => 'Awaiting IT manager',
        'completed' => 'Completed',
        'rejected' => 'Rejected',
    ],
    'ticket' => [
        'signature_invalid' => 'Invalid signature. Please sign again.',
    ],
    'kpi' => [
        'future_date' => 'The work date cannot be in the future.',
    ],
    'expiring' => [
        'subject' => 'Reminder: :count item(s) expiring soon',
        'greeting' => 'Dear IT team,',
        'intro' => 'The following items are expiring soon or have expired. Please review and renew them.',
        'type' => ['contract' => 'Contract', 'credential' => 'Account/password'],
        'expired' => 'expired',
        'days_left' => ':days days left',
        'open' => 'Open in IT-SYSTEM',
    ],
    'validation' => [
        'asset_tag_regex' => 'Asset tag may only contain A-Z, 0-9, - _ /',
        'asset_tag_unique' => 'This asset tag already exists.',
        'purchase_date_future' => 'The purchase date cannot be in the future.',
    ],
];
