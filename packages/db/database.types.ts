
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "areas": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"location_id": string,"name": string,"organization_id": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"location_id": string,"name": string,"organization_id": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"location_id"?: string,"name"?: string,"organization_id"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "areas_location_org_fk"
      columns: ["location_id","organization_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"entity_id": string | null,"entity_type": string | null,"id": number,"metadata": NonNullable<Json>,"organization_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string | null,"id"?: never,"metadata"?: NonNullable<Json>,"organization_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string | null,"id"?: never,"metadata"?: NonNullable<Json>,"organization_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"default_role_permissions": {
                  Row: {
                    "permission_key": string,"role_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "permission_key": string,"role_key": string
                  }
                  Update: {
                    "permission_key"?: string,"role_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "default_role_permissions_permission_key_fkey"
      columns: ["permission_key"]
isOneToOne: false
      referencedRelation: "permissions"
      referencedColumns: ["key"]
    }
                  ]
                },"item_variants": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"item_id": string,"name": string,"organization_id": string,"price_delta": number,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"item_id": string,"name": string,"organization_id": string,"price_delta"?: number,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"item_id"?: string,"name"?: string,"organization_id"?: string,"price_delta"?: number,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_variants_item_org_fk"
      columns: ["item_id","organization_id"]
isOneToOne: false
      referencedRelation: "menu_items"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"kitchen_stations": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"location_id": string,"name": string,"organization_id": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"location_id": string,"name": string,"organization_id": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"location_id"?: string,"name"?: string,"organization_id"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "kitchen_stations_location_org_fk"
      columns: ["location_id","organization_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"location_menu_overrides": {
                  Row: {
                    "created_at": string,"id": string,"is_available": boolean,"item_id": string,"kitchen_station_id": string | null,"location_id": string,"organization_id": string,"price_override": number | null,"sold_out_until": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_available"?: boolean,"item_id": string,"kitchen_station_id"?: string | null,"location_id": string,"organization_id": string,"price_override"?: number | null,"sold_out_until"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_available"?: boolean,"item_id"?: string,"kitchen_station_id"?: string | null,"location_id"?: string,"organization_id"?: string,"price_override"?: number | null,"sold_out_until"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lmo_item_org_fk"
      columns: ["item_id","organization_id"]
isOneToOne: false
      referencedRelation: "menu_items"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "lmo_location_org_fk"
      columns: ["location_id","organization_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "lmo_station_location_fk"
      columns: ["kitchen_station_id","location_id"]
isOneToOne: false
      referencedRelation: "kitchen_stations"
      referencedColumns: ["id","location_id"]
    }
                  ]
                },"location_staff": {
                  Row: {
                    "created_at": string,"location_id": string,"member_id": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"location_id": string,"member_id": string,"organization_id": string
                  }
                  Update: {
                    "created_at"?: string,"location_id"?: string,"member_id"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "location_staff_location_id_organization_id_fkey"
      columns: ["location_id","organization_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "location_staff_member_id_organization_id_fkey"
      columns: ["member_id","organization_id"]
isOneToOne: false
      referencedRelation: "organization_members"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"locations": {
                  Row: {
                    "address": string | null,"city": string | null,"created_at": string,"currency": string,"id": string,"is_active": boolean,"name": string,"organization_id": string,"phone": string | null,"service_charge_bps": number,"tax_on_service_charge": boolean,"tax_rate_bps": number,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"city"?: string | null,"created_at"?: string,"currency"?: string,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"phone"?: string | null,"service_charge_bps"?: number,"tax_on_service_charge"?: boolean,"tax_rate_bps"?: number,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"city"?: string | null,"created_at"?: string,"currency"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"phone"?: string | null,"service_charge_bps"?: number,"tax_on_service_charge"?: boolean,"tax_rate_bps"?: number,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "locations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"menu_categories": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"is_active": boolean,"name": string,"organization_id": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "menu_categories_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"menu_item_modifier_groups": {
                  Row: {
                    "created_at": string,"group_id": string,"item_id": string,"organization_id": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_id": string,"item_id": string,"organization_id": string,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string,"item_id"?: string,"organization_id"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "mimg_group_org_fk"
      columns: ["group_id","organization_id"]
isOneToOne: false
      referencedRelation: "modifier_groups"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "mimg_item_org_fk"
      columns: ["item_id","organization_id"]
isOneToOne: false
      referencedRelation: "menu_items"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"menu_items": {
                  Row: {
                    "base_price": number,"category_id": string,"created_at": string,"description": string | null,"dietary_tags": (string)[],"id": string,"image_path": string | null,"is_active": boolean,"is_published": boolean,"name": string,"organization_id": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "base_price": number,"category_id": string,"created_at"?: string,"description"?: string | null,"dietary_tags"?: (string)[],"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"is_published"?: boolean,"name": string,"organization_id": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "base_price"?: number,"category_id"?: string,"created_at"?: string,"description"?: string | null,"dietary_tags"?: (string)[],"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"is_published"?: boolean,"name"?: string,"organization_id"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "menu_items_category_org_fk"
      columns: ["category_id","organization_id"]
isOneToOne: false
      referencedRelation: "menu_categories"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"modifier_groups": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"max_select": number,"min_select": number,"name": string,"organization_id": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"max_select"?: number,"min_select"?: number,"name": string,"organization_id": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"max_select"?: number,"min_select"?: number,"name"?: string,"organization_id"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "modifier_groups_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"modifiers": {
                  Row: {
                    "created_at": string,"group_id": string,"id": string,"is_active": boolean,"name": string,"organization_id": string,"price_delta": number,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_id": string,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"price_delta"?: number,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"price_delta"?: number,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "modifiers_group_org_fk"
      columns: ["group_id","organization_id"]
isOneToOne: false
      referencedRelation: "modifier_groups"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"org_branding": {
                  Row: {
                    "created_at": string,"font": string | null,"logo_path": string | null,"logo_url": string | null,"organization_id": string,"primary_color": string | null,"secondary_color": string | null,"theme": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"font"?: string | null,"logo_path"?: string | null,"logo_url"?: string | null,"organization_id": string,"primary_color"?: string | null,"secondary_color"?: string | null,"theme"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"font"?: string | null,"logo_path"?: string | null,"logo_url"?: string | null,"organization_id"?: string,"primary_color"?: string | null,"secondary_color"?: string | null,"theme"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_branding_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organization_members": {
                  Row: {
                    "all_locations": boolean,"created_at": string,"id": string,"invited_by": string | null,"joined_at": string,"organization_id": string,"role_id": string,"status": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "all_locations"?: boolean,"created_at"?: string,"id"?: string,"invited_by"?: string | null,"joined_at"?: string,"organization_id": string,"role_id": string,"status"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "all_locations"?: boolean,"created_at"?: string,"id"?: string,"invited_by"?: string | null,"joined_at"?: string,"organization_id"?: string,"role_id"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_members_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_members_role_id_organization_id_fkey"
      columns: ["role_id","organization_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "contact_email": string | null,"created_at": string,"created_by": string | null,"currency": string,"id": string,"name": string,"slug": string,"status": string,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "contact_email"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"id"?: string,"name": string,"slug": string,"status"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "contact_email"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"id"?: string,"name"?: string,"slug"?: string,"status"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"packages": {
                  Row: {
                    "code": string,"created_at": string,"currency": string,"description": string | null,"features": (string)[],"id": string,"is_active": boolean,"is_default": boolean,"is_public": boolean,"limits": NonNullable<Json>,"name": string,"price_monthly": number,"price_yearly": number,"sort_order": number,"trial_days": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"currency"?: string,"description"?: string | null,"features"?: (string)[],"id"?: string,"is_active"?: boolean,"is_default"?: boolean,"is_public"?: boolean,"limits"?: NonNullable<Json>,"name": string,"price_monthly"?: number,"price_yearly"?: number,"sort_order"?: number,"trial_days"?: number,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"currency"?: string,"description"?: string | null,"features"?: (string)[],"id"?: string,"is_active"?: boolean,"is_default"?: boolean,"is_public"?: boolean,"limits"?: NonNullable<Json>,"name"?: string,"price_monthly"?: number,"price_yearly"?: number,"sort_order"?: number,"trial_days"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"permissions": {
                  Row: {
                    "category": string,"description": string,"key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"description": string,"key": string
                  }
                  Update: {
                    "category"?: string,"description"?: string,"key"?: string
                  }
                  Relationships: [
                    
                  ]
                },"platform_admins": {
                  Row: {
                    "created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"platform_settings": {
                  Row: {
                    "created_at": string,"key": string,"updated_at": string,"updated_by": string | null,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"key": string,"updated_at"?: string,"updated_by"?: string | null,"value"?: NonNullable<Json>
                  }
                  Update: {
                    "created_at"?: string,"key"?: string,"updated_at"?: string,"updated_by"?: string | null,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"email": string | null,"full_name": string | null,"id": string,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"email"?: string | null,"full_name"?: string | null,"id": string,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"email"?: string | null,"full_name"?: string | null,"id"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"reserved_slugs": {
                  Row: {
                    "reason": string | null,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "reason"?: string | null,"slug": string
                  }
                  Update: {
                    "reason"?: string | null,"slug"?: string
                  }
                  Relationships: [
                    
                  ]
                },"role_permissions": {
                  Row: {
                    "organization_id": string,"permission_key": string,"role_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "organization_id": string,"permission_key": string,"role_id": string
                  }
                  Update: {
                    "organization_id"?: string,"permission_key"?: string,"role_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "role_permissions_permission_key_fkey"
      columns: ["permission_key"]
isOneToOne: false
      referencedRelation: "permissions"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "role_permissions_role_id_organization_id_fkey"
      columns: ["role_id","organization_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"roles": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"is_system": boolean,"key": string,"name": string,"organization_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_system"?: boolean,"key": string,"name": string,"organization_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_system"?: boolean,"key"?: string,"name"?: string,"organization_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "roles_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"all_locations": boolean,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string | null,"location_ids": (string)[],"organization_id": string,"revoked_at": string | null,"role_id": string,"send_count": number,"token_hash": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"all_locations"?: boolean,"created_at"?: string,"email": string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"location_ids"?: (string)[],"organization_id": string,"revoked_at"?: string | null,"role_id": string,"send_count"?: number,"token_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"all_locations"?: boolean,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"location_ids"?: (string)[],"organization_id"?: string,"revoked_at"?: string | null,"role_id"?: string,"send_count"?: number,"token_hash"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_invitations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_invitations_role_id_organization_id_fkey"
      columns: ["role_id","organization_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"subscriptions": {
                  Row: {
                    "billing_period": string,"canceled_at": string | null,"created_at": string,"current_period_end": string | null,"current_period_start": string | null,"id": string,"organization_id": string,"package_id": string,"status": string,"trial_ends_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "billing_period"?: string,"canceled_at"?: string | null,"created_at"?: string,"current_period_end"?: string | null,"current_period_start"?: string | null,"id"?: string,"organization_id": string,"package_id": string,"status"?: string,"trial_ends_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "billing_period"?: string,"canceled_at"?: string | null,"created_at"?: string,"current_period_end"?: string | null,"current_period_start"?: string | null,"id"?: string,"organization_id"?: string,"package_id"?: string,"status"?: string,"trial_ends_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscriptions_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscriptions_package_id_fkey"
      columns: ["package_id"]
isOneToOne: false
      referencedRelation: "packages"
      referencedColumns: ["id"]
    }
                  ]
                },"tables": {
                  Row: {
                    "area_id": string,"capacity": number,"created_at": string,"id": string,"is_active": boolean,"label": string,"location_id": string,"organization_id": string,"pos_x": number | null,"pos_y": number | null,"qr_rotated_at": string | null,"qr_token": string,"shape": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "area_id": string,"capacity": number,"created_at"?: string,"id"?: string,"is_active"?: boolean,"label": string,"location_id": string,"organization_id": string,"pos_x"?: number | null,"pos_y"?: number | null,"qr_rotated_at"?: string | null,"qr_token": string,"shape"?: string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "area_id"?: string,"capacity"?: number,"created_at"?: string,"id"?: string,"is_active"?: boolean,"label"?: string,"location_id"?: string,"organization_id"?: string,"pos_x"?: number | null,"pos_y"?: number | null,"qr_rotated_at"?: string | null,"qr_token"?: string,"shape"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tables_area_location_fk"
      columns: ["area_id","location_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id","location_id"]
    },{
      foreignKeyName: "tables_location_org_fk"
      columns: ["location_id","organization_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invitation":
{ Args: { "token": string }; Returns: Json
                           },
"admin_create_package":
{ Args: { "input": Json }; Returns: string
                           },
"admin_get_platform_settings":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_list_tenants":
{ Args: { "org_id"?: string,"package_code"?: string,"page_offset"?: number,"page_size"?: number,"q"?: string,"status_filter"?: string }; Returns: Json
                           },
"admin_set_default_package":
{ Args: { "package_id": string }; Returns: boolean
                           },
"admin_set_org_status":
{ Args: { "org": string,"reason": string,"status": string }; Returns: boolean
                           },
"admin_set_package_active":
{ Args: { "active": boolean,"package_id": string }; Returns: boolean
                           },
"admin_update_package":
{ Args: { "input": Json,"package_id": string }; Returns: boolean
                           },
"admin_update_platform_setting":
{ Args: { "key": string,"value": Json }; Returns: boolean
                           },
"create_organization":
{ Args: { "branding"?: Json,"location": Json,"name": string,"package_code"?: string,"slug": string }; Returns: Json
                           },
"get_invitation_preview":
{ Args: { "token": string }; Returns: Json
                           },
"get_org_package":
{ Args: { "org": string }; Returns: Json
                           },
"get_public_menu":
{ Args: { "location_id": string,"org_slug": string }; Returns: Json
                           },
"get_public_platform_flags":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_storefront":
{ Args: { "slug": string }; Returns: Json
                           },
"get_table_qr_tokens":
{ Args: { "location_id": string,"table_ids"?: (string)[] }; Returns: {
              "area_name": string,"label": string,"qr_token": string,"table_id": string
            }[]
                           },
"has_location_access":
{ Args: { "location": string }; Returns: boolean
                           },
"has_permission":
{ Args: { "org": string,"perm": string }; Returns: boolean
                           },
"is_org_active":
{ Args: { "org": string }; Returns: boolean
                           },
"is_org_member":
{ Args: { "org": string }; Returns: boolean
                           },
"is_org_member_any_status":
{ Args: { "org": string }; Returns: boolean
                           },
"is_org_owner":
{ Args: { "org": string }; Returns: boolean
                           },
"is_platform_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_slug_available":
{ Args: { "slug": string }; Returns: boolean
                           },
"my_org_membership":
{ Args: { "org_slug": string }; Returns: Json
                           },
"my_permissions":
{ Args: { "org": string }; Returns: (string)[]
                           },
"org_active_table_count":
{ Args: { "org_id": string }; Returns: number
                           },
"resolve_table_qr":
{ Args: { "token": string }; Returns: {
              "label": string,"location_id": string,"org_slug": string,"table_id": string
            }[]
                           },
"rotate_table_qr_token":
{ Args: { "table_id": string }; Returns: string
                           },
"set_item_sold_out":
{ Args: { "item_id": string,"location_id": string,"sold_out": boolean }; Returns: string
                           },
"set_member_locations":
{ Args: { "all_locations": boolean,"location_ids"?: (string)[],"member": string }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
