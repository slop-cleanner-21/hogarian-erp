export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      adelantos: {
        Row: {
          cantidad: number;
          created_at: string;
          created_by: string;
          id: number;
          item_id: number;
          obra_id: number;
          partida_destino_id: number;
          partida_origen_id: number;
          requerimiento_id: number;
        };
        ComputedFields: never;
        Insert: {
          cantidad: number;
          created_at?: string;
          created_by?: string;
          id?: number;
          item_id: number;
          obra_id: number;
          partida_destino_id: number;
          partida_origen_id: number;
          requerimiento_id: number;
        };
        Update: {
          cantidad?: number;
          created_at?: string;
          created_by?: string;
          id?: number;
          item_id?: number;
          obra_id?: number;
          partida_destino_id?: number;
          partida_origen_id?: number;
          requerimiento_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "adelantos_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "adelantos_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "v_items_sin_cuenta";
            referencedColumns: ["item_id"];
          },
          {
            foreignKeyName: "adelantos_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "adelantos_partida_destino_id_fkey";
            columns: ["partida_destino_id"];
            isOneToOne: false;
            referencedRelation: "partidas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "adelantos_partida_destino_id_fkey";
            columns: ["partida_destino_id"];
            isOneToOne: false;
            referencedRelation: "v_avance_partida";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "adelantos_partida_destino_id_fkey";
            columns: ["partida_destino_id"];
            isOneToOne: false;
            referencedRelation: "v_partidas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "adelantos_partida_destino_id_fkey";
            columns: ["partida_destino_id"];
            isOneToOne: false;
            referencedRelation: "v_presupuesto_efectivo";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "adelantos_partida_destino_id_fkey";
            columns: ["partida_destino_id"];
            isOneToOne: false;
            referencedRelation: "v_seguimiento_partida";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "adelantos_partida_origen_id_fkey";
            columns: ["partida_origen_id"];
            isOneToOne: false;
            referencedRelation: "partidas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "adelantos_partida_origen_id_fkey";
            columns: ["partida_origen_id"];
            isOneToOne: false;
            referencedRelation: "v_avance_partida";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "adelantos_partida_origen_id_fkey";
            columns: ["partida_origen_id"];
            isOneToOne: false;
            referencedRelation: "v_partidas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "adelantos_partida_origen_id_fkey";
            columns: ["partida_origen_id"];
            isOneToOne: false;
            referencedRelation: "v_presupuesto_efectivo";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "adelantos_partida_origen_id_fkey";
            columns: ["partida_origen_id"];
            isOneToOne: false;
            referencedRelation: "v_seguimiento_partida";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "adelantos_requerimiento_id_fkey";
            columns: ["requerimiento_id"];
            isOneToOne: false;
            referencedRelation: "requerimientos_obra";
            referencedColumns: ["id"];
          },
        ];
      };
      adjuntos: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: number;
          mime: string | null;
          nombre: string;
          numero_oc: string | null;
          obra_id: number | null;
          orden_pago_id: number | null;
          pago_id: number | null;
          path: string;
          tipo: Database["public"]["Enums"]["tipo_adjunto"];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: number;
          mime?: string | null;
          nombre: string;
          numero_oc?: string | null;
          obra_id?: number | null;
          orden_pago_id?: number | null;
          pago_id?: number | null;
          path: string;
          tipo: Database["public"]["Enums"]["tipo_adjunto"];
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: number;
          mime?: string | null;
          nombre?: string;
          numero_oc?: string | null;
          obra_id?: number | null;
          orden_pago_id?: number | null;
          pago_id?: number | null;
          path?: string;
          tipo?: Database["public"]["Enums"]["tipo_adjunto"];
        };
        Relationships: [
          {
            foreignKeyName: "adjuntos_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "ordenes_compra";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "adjuntos_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_ordenes";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "adjuntos_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_os_retenidas";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "adjuntos_orden_pago_id_fkey";
            columns: ["orden_pago_id"];
            isOneToOne: false;
            referencedRelation: "ordenes_pago";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "adjuntos_pago_id_fkey";
            columns: ["pago_id"];
            isOneToOne: false;
            referencedRelation: "pagos";
            referencedColumns: ["id"];
          },
        ];
      };
      asiento_lineas: {
        Row: {
          amarre: boolean;
          asiento_id: number;
          cuenta: string;
          debe: number;
          glosa: string | null;
          haber: number;
          id: number;
          orden: number | null;
        };
        ComputedFields: never;
        Insert: {
          amarre?: boolean;
          asiento_id: number;
          cuenta: string;
          debe?: number;
          glosa?: string | null;
          haber?: number;
          id?: number;
          orden?: number | null;
        };
        Update: {
          amarre?: boolean;
          asiento_id?: number;
          cuenta?: string;
          debe?: number;
          glosa?: string | null;
          haber?: number;
          id?: number;
          orden?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "asiento_lineas_asiento_id_fkey";
            columns: ["asiento_id"];
            isOneToOne: false;
            referencedRelation: "asientos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "asiento_lineas_asiento_id_fkey";
            columns: ["asiento_id"];
            isOneToOne: false;
            referencedRelation: "v_comprobantes";
            referencedColumns: ["asiento_id"];
          },
          {
            foreignKeyName: "asiento_lineas_asiento_id_fkey";
            columns: ["asiento_id"];
            isOneToOne: false;
            referencedRelation: "v_registro_compras";
            referencedColumns: ["asiento_id"];
          },
          {
            foreignKeyName: "asiento_lineas_cuenta_fkey";
            columns: ["cuenta"];
            isOneToOne: false;
            referencedRelation: "cuentas_contables";
            referencedColumns: ["codigo"];
          },
        ];
      };
      asientos: {
        Row: {
          comprobante_id: number | null;
          created_at: string;
          created_by: string | null;
          empresa_id: number;
          fecha: string;
          glosa: string;
          id: number;
          origen: string;
          pago_id: number | null;
        };
        ComputedFields: never;
        Insert: {
          comprobante_id?: number | null;
          created_at?: string;
          created_by?: string | null;
          empresa_id: number;
          fecha: string;
          glosa: string;
          id?: number;
          origen: string;
          pago_id?: number | null;
        };
        Update: {
          comprobante_id?: number | null;
          created_at?: string;
          created_by?: string | null;
          empresa_id?: number;
          fecha?: string;
          glosa?: string;
          id?: number;
          origen?: string;
          pago_id?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "asientos_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "comprobantes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "asientos_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_comprobantes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "asientos_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_expediente";
            referencedColumns: ["comprobante_id"];
          },
          {
            foreignKeyName: "asientos_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_registro_compras";
            referencedColumns: ["comprobante_id"];
          },
          {
            foreignKeyName: "asientos_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "asientos_pago_id_fkey";
            columns: ["pago_id"];
            isOneToOne: false;
            referencedRelation: "pagos";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          accion: string;
          created_at: string;
          detalle: Json | null;
          id: number;
          registro: string | null;
          tabla: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          accion: string;
          created_at?: string;
          detalle?: Json | null;
          id?: number;
          registro?: string | null;
          tabla: string;
          user_id?: string | null;
        };
        Update: {
          accion?: string;
          created_at?: string;
          detalle?: Json | null;
          id?: number;
          registro?: string | null;
          tabla?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      avance_fotos: {
        Row: {
          avance_id: number;
          id: number;
          path: string;
        };
        ComputedFields: never;
        Insert: {
          avance_id: number;
          id?: number;
          path: string;
        };
        Update: {
          avance_id?: number;
          id?: number;
          path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "avance_fotos_avance_id_fkey";
            columns: ["avance_id"];
            isOneToOne: false;
            referencedRelation: "avances";
            referencedColumns: ["id"];
          },
        ];
      };
      avances: {
        Row: {
          cantidad: number;
          capturado_en: string | null;
          created_at: string;
          created_by: string;
          estado: string;
          fecha: string;
          id: number;
          lat: number | null;
          lng: number | null;
          obra_id: number;
          observacion: string | null;
          observacion_operaciones: string | null;
          observado_at: string | null;
          observado_by: string | null;
          partida_id: number;
          precision_m: number | null;
          reemplaza_id: number | null;
          valorizacion_id: number | null;
        };
        ComputedFields: never;
        Insert: {
          cantidad: number;
          capturado_en?: string | null;
          created_at?: string;
          created_by?: string;
          estado?: string;
          fecha?: string;
          id?: number;
          lat?: number | null;
          lng?: number | null;
          obra_id: number;
          observacion?: string | null;
          observacion_operaciones?: string | null;
          observado_at?: string | null;
          observado_by?: string | null;
          partida_id: number;
          precision_m?: number | null;
          reemplaza_id?: number | null;
          valorizacion_id?: number | null;
        };
        Update: {
          cantidad?: number;
          capturado_en?: string | null;
          created_at?: string;
          created_by?: string;
          estado?: string;
          fecha?: string;
          id?: number;
          lat?: number | null;
          lng?: number | null;
          obra_id?: number;
          observacion?: string | null;
          observacion_operaciones?: string | null;
          observado_at?: string | null;
          observado_by?: string | null;
          partida_id?: number;
          precision_m?: number | null;
          reemplaza_id?: number | null;
          valorizacion_id?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "avances_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "avances_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "partidas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "avances_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_avance_partida";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "avances_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_partidas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "avances_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_presupuesto_efectivo";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "avances_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_seguimiento_partida";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "avances_reemplaza_id_fkey";
            columns: ["reemplaza_id"];
            isOneToOne: false;
            referencedRelation: "avances";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "avances_valorizacion_id_fkey";
            columns: ["valorizacion_id"];
            isOneToOne: false;
            referencedRelation: "valorizaciones";
            referencedColumns: ["id"];
          },
        ];
      };
      aviso_preferencias: {
        Row: {
          avisar: boolean;
          celular: boolean;
          tipo: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          avisar: boolean;
          celular: boolean;
          tipo: string;
          user_id: string;
        };
        Update: {
          avisar?: boolean;
          celular?: boolean;
          tipo?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      comprobantes: {
        Row: {
          anulado_at: string | null;
          anulado_motivo: string | null;
          archivo_path: string | null;
          base: number;
          created_at: string;
          created_by: string | null;
          destino_igv: string;
          detraccion: number;
          empresa_id: number;
          fecha_emision: string;
          historico: boolean;
          id: number;
          igv: number;
          numero: string;
          periodo_anotacion: string;
          proveedor_id: number;
          retencion: number;
          serie: string;
          tipo: Database["public"]["Enums"]["tipo_comprobante"];
          total: number;
        };
        ComputedFields: never;
        Insert: {
          anulado_at?: string | null;
          anulado_motivo?: string | null;
          archivo_path?: string | null;
          base: number;
          created_at?: string;
          created_by?: string | null;
          destino_igv?: string;
          detraccion?: number;
          empresa_id: number;
          fecha_emision: string;
          historico?: boolean;
          id?: number;
          igv: number;
          numero: string;
          periodo_anotacion: string;
          proveedor_id: number;
          retencion?: number;
          serie: string;
          tipo: Database["public"]["Enums"]["tipo_comprobante"];
          total: number;
        };
        Update: {
          anulado_at?: string | null;
          anulado_motivo?: string | null;
          archivo_path?: string | null;
          base?: number;
          created_at?: string;
          created_by?: string | null;
          destino_igv?: string;
          detraccion?: number;
          empresa_id?: number;
          fecha_emision?: string;
          historico?: boolean;
          id?: number;
          igv?: number;
          numero?: string;
          periodo_anotacion?: string;
          proveedor_id?: number;
          retencion?: number;
          serie?: string;
          tipo?: Database["public"]["Enums"]["tipo_comprobante"];
          total?: number;
        };
        Relationships: [
          {
            foreignKeyName: "comprobantes_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comprobantes_proveedor_id_fkey";
            columns: ["proveedor_id"];
            isOneToOne: false;
            referencedRelation: "proveedores";
            referencedColumns: ["id"];
          },
        ];
      };
      comprobantes_historial: {
        Row: {
          anterior: NonNullable<Json>;
          comprobante_id: number;
          editado_at: string;
          editado_by: string | null;
          id: number;
          motivo: string | null;
          nuevo: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          anterior: NonNullable<Json>;
          comprobante_id: number;
          editado_at?: string;
          editado_by?: string | null;
          id?: number;
          motivo?: string | null;
          nuevo: NonNullable<Json>;
        };
        Update: {
          anterior?: NonNullable<Json>;
          comprobante_id?: number;
          editado_at?: string;
          editado_by?: string | null;
          id?: number;
          motivo?: string | null;
          nuevo?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "comprobantes_historial_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "comprobantes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comprobantes_historial_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_comprobantes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comprobantes_historial_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_expediente";
            referencedColumns: ["comprobante_id"];
          },
          {
            foreignKeyName: "comprobantes_historial_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_registro_compras";
            referencedColumns: ["comprobante_id"];
          },
        ];
      };
      cotizacion_accesos: {
        Row: {
          accion: string;
          created_at: string;
          id: number;
          numero: string | null;
          obra_id: number | null;
          ok: boolean;
          token: string | null;
        };
        ComputedFields: never;
        Insert: {
          accion: string;
          created_at?: string;
          id?: number;
          numero?: string | null;
          obra_id?: number | null;
          ok: boolean;
          token?: string | null;
        };
        Update: {
          accion?: string;
          created_at?: string;
          id?: number;
          numero?: string | null;
          obra_id?: number | null;
          ok?: boolean;
          token?: string | null;
        };
        Relationships: [];
      };
      credenciales: {
        Row: {
          cambiada_at: string;
          hash: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          cambiada_at?: string;
          hash: string;
          user_id: string;
        };
        Update: {
          cambiada_at?: string;
          hash?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      cuentas_contables: {
        Row: {
          amarre_debe: string | null;
          amarre_haber: string | null;
          codigo: string;
          denominacion: string;
          tipo: string;
        };
        ComputedFields: never;
        Insert: {
          amarre_debe?: string | null;
          amarre_haber?: string | null;
          codigo: string;
          denominacion: string;
          tipo: string;
        };
        Update: {
          amarre_debe?: string | null;
          amarre_haber?: string | null;
          codigo?: string;
          denominacion?: string;
          tipo?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cuentas_contables_amarre_debe_fkey";
            columns: ["amarre_debe"];
            isOneToOne: false;
            referencedRelation: "cuentas_contables";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "cuentas_contables_amarre_haber_fkey";
            columns: ["amarre_haber"];
            isOneToOne: false;
            referencedRelation: "cuentas_contables";
            referencedColumns: ["codigo"];
          },
        ];
      };
      datos_demo: {
        Row: {
          archivo: string | null;
          created_at: string;
          id: number;
          registro_id: string;
          tabla: string;
        };
        ComputedFields: never;
        Insert: {
          archivo?: string | null;
          created_at?: string;
          id?: number;
          registro_id: string;
          tabla: string;
        };
        Update: {
          archivo?: string | null;
          created_at?: string;
          id?: number;
          registro_id?: string;
          tabla?: string;
        };
        Relationships: [];
      };
      detracciones: {
        Row: {
          item_id: number;
          obra_id: number;
          porcentaje: number;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          item_id: number;
          obra_id: number;
          porcentaje?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          item_id?: number;
          obra_id?: number;
          porcentaje?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "detracciones_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "detracciones_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "v_items_sin_cuenta";
            referencedColumns: ["item_id"];
          },
          {
            foreignKeyName: "detracciones_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
        ];
      };
      empresas: {
        Row: {
          direccion: string | null;
          firmante_id: string | null;
          id: number;
          nombre: string;
          razon_social: string | null;
          ruc: string | null;
        };
        ComputedFields: never;
        Insert: {
          direccion?: string | null;
          firmante_id?: string | null;
          id?: number;
          nombre: string;
          razon_social?: string | null;
          ruc?: string | null;
        };
        Update: {
          direccion?: string | null;
          firmante_id?: string | null;
          id?: number;
          nombre?: string;
          razon_social?: string | null;
          ruc?: string | null;
        };
        Relationships: [];
      };
      entrega_fotos: {
        Row: {
          created_at: string;
          entrega_id: number;
          id: number;
          path: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          entrega_id: number;
          id?: number;
          path: string;
        };
        Update: {
          created_at?: string;
          entrega_id?: number;
          id?: number;
          path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "entrega_fotos_entrega_id_fkey";
            columns: ["entrega_id"];
            isOneToOne: false;
            referencedRelation: "entregas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "entrega_fotos_entrega_id_fkey";
            columns: ["entrega_id"];
            isOneToOne: false;
            referencedRelation: "v_entregas_partida";
            referencedColumns: ["id"];
          },
        ];
      };
      entregas: {
        Row: {
          cantidad: number;
          capturado_en: string | null;
          created_at: string;
          created_by: string;
          id: number;
          lat: number | null;
          lng: number | null;
          numero_oc: string;
          obra_id: number;
          observacion: string | null;
          oc_item_id: number;
          precision_m: number | null;
          rol: string;
        };
        ComputedFields: never;
        Insert: {
          cantidad: number;
          capturado_en?: string | null;
          created_at?: string;
          created_by?: string;
          id?: number;
          lat?: number | null;
          lng?: number | null;
          numero_oc: string;
          obra_id: number;
          observacion?: string | null;
          oc_item_id: number;
          precision_m?: number | null;
          rol: string;
        };
        Update: {
          cantidad?: number;
          capturado_en?: string | null;
          created_at?: string;
          created_by?: string;
          id?: number;
          lat?: number | null;
          lng?: number | null;
          numero_oc?: string;
          obra_id?: number;
          observacion?: string | null;
          oc_item_id?: number;
          precision_m?: number | null;
          rol?: string;
        };
        Relationships: [
          {
            foreignKeyName: "entregas_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "ordenes_compra";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "entregas_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_ordenes";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "entregas_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_os_retenidas";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "entregas_oc_item_id_fkey";
            columns: ["oc_item_id"];
            isOneToOne: false;
            referencedRelation: "oc_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "entregas_oc_item_id_fkey";
            columns: ["oc_item_id"];
            isOneToOne: false;
            referencedRelation: "v_entregas_item";
            referencedColumns: ["oc_item_id"];
          },
          {
            foreignKeyName: "entregas_oc_item_id_fkey";
            columns: ["oc_item_id"];
            isOneToOne: false;
            referencedRelation: "v_oc_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "entregas_oc_item_id_fkey";
            columns: ["oc_item_id"];
            isOneToOne: false;
            referencedRelation: "v_oc_items_calc";
            referencedColumns: ["id"];
          },
        ];
      };
      etapas: {
        Row: {
          codigo: string;
          grupo: string;
          orden: number;
        };
        ComputedFields: never;
        Insert: {
          codigo: string;
          grupo: string;
          orden?: number;
        };
        Update: {
          codigo?: string;
          grupo?: string;
          orden?: number;
        };
        Relationships: [];
      };
      guias: {
        Row: {
          anulada_at: string | null;
          archivo_path: string | null;
          detalle: string;
          emitido_at: string | null;
          emitido_by: string | null;
          estado: string;
          fecha_traslado: string;
          id: number;
          licencia: string;
          modalidad: string;
          numero_guia: string | null;
          numero_oc: string;
          obra_id: number;
          placa: string;
          punto_llegada: string;
          punto_partida: string;
          ruc_remitente: string;
          ruc_transportista: string;
          solicitado_at: string;
          solicitado_by: string | null;
          transportista: string;
          transportista_id: number | null;
        };
        ComputedFields: never;
        Insert: {
          anulada_at?: string | null;
          archivo_path?: string | null;
          detalle: string;
          emitido_at?: string | null;
          emitido_by?: string | null;
          estado?: string;
          fecha_traslado: string;
          id?: number;
          licencia: string;
          modalidad?: string;
          numero_guia?: string | null;
          numero_oc: string;
          obra_id: number;
          placa: string;
          punto_llegada: string;
          punto_partida: string;
          ruc_remitente: string;
          ruc_transportista: string;
          solicitado_at?: string;
          solicitado_by?: string | null;
          transportista: string;
          transportista_id?: number | null;
        };
        Update: {
          anulada_at?: string | null;
          archivo_path?: string | null;
          detalle?: string;
          emitido_at?: string | null;
          emitido_by?: string | null;
          estado?: string;
          fecha_traslado?: string;
          id?: number;
          licencia?: string;
          modalidad?: string;
          numero_guia?: string | null;
          numero_oc?: string;
          obra_id?: number;
          placa?: string;
          punto_llegada?: string;
          punto_partida?: string;
          ruc_remitente?: string;
          ruc_transportista?: string;
          solicitado_at?: string;
          solicitado_by?: string | null;
          transportista?: string;
          transportista_id?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "guias_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "ordenes_compra";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "guias_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_ordenes";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "guias_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_os_retenidas";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "guias_transportista_id_fkey";
            columns: ["transportista_id"];
            isOneToOne: false;
            referencedRelation: "transportistas";
            referencedColumns: ["id"];
          },
        ];
      };
      huella_desafios: {
        Row: {
          challenge: string;
          expira_at: string;
          id: string;
          ip: string | null;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          challenge: string;
          expira_at?: string;
          id?: string;
          ip?: string | null;
          user_id?: string | null;
        };
        Update: {
          challenge?: string;
          expira_at?: string;
          id?: string;
          ip?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      huellas: {
        Row: {
          counter: number;
          created_at: string;
          credential_id: string;
          dispositivo: string | null;
          id: string;
          public_key: string;
          rp_id: string;
          transports: string[];
          usada_at: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          counter?: number;
          created_at?: string;
          credential_id: string;
          dispositivo?: string | null;
          id?: string;
          public_key: string;
          rp_id: string;
          transports?: string[];
          usada_at?: string | null;
          user_id: string;
        };
        Update: {
          counter?: number;
          created_at?: string;
          credential_id?: string;
          dispositivo?: string | null;
          id?: string;
          public_key?: string;
          rp_id?: string;
          transports?: string[];
          usada_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      invitaciones: {
        Row: {
          creada_por: string | null;
          created_at: string;
          expira_at: string;
          id: number;
          token_hash: string;
          usada_at: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          creada_por?: string | null;
          created_at?: string;
          expira_at: string;
          id?: never;
          token_hash: string;
          usada_at?: string | null;
          user_id: string;
        };
        Update: {
          creada_por?: string | null;
          created_at?: string;
          expira_at?: string;
          id?: never;
          token_hash?: string;
          usada_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      items: {
        Row: {
          cuenta_contable: string | null;
          descripcion: string;
          id: number;
          numero: number | null;
          rubro: Database["public"]["Enums"]["rubro"];
          tipo_material: string | null;
          tolerancia_pct: number;
          unidad: string | null;
        };
        ComputedFields: never;
        Insert: {
          cuenta_contable?: string | null;
          descripcion: string;
          id?: number;
          numero?: number | null;
          rubro: Database["public"]["Enums"]["rubro"];
          tipo_material?: string | null;
          tolerancia_pct?: number;
          unidad?: string | null;
        };
        Update: {
          cuenta_contable?: string | null;
          descripcion?: string;
          id?: number;
          numero?: number | null;
          rubro?: Database["public"]["Enums"]["rubro"];
          tipo_material?: string | null;
          tolerancia_pct?: number;
          unidad?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "items_cuenta_contable_fkey";
            columns: ["cuenta_contable"];
            isOneToOne: false;
            referencedRelation: "cuentas_contables";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "items_tipo_material_fkey";
            columns: ["tipo_material"];
            isOneToOne: false;
            referencedRelation: "tipos_material";
            referencedColumns: ["codigo"];
          },
        ];
      };
      notificaciones: {
        Row: {
          created_at: string;
          cuerpo: string | null;
          href: string | null;
          id: number;
          leida_at: string | null;
          push: boolean;
          push_enviado_at: string | null;
          tipo: string;
          titulo: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          cuerpo?: string | null;
          href?: string | null;
          id?: number;
          leida_at?: string | null;
          push?: boolean;
          push_enviado_at?: string | null;
          tipo: string;
          titulo: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          cuerpo?: string | null;
          href?: string | null;
          id?: number;
          leida_at?: string | null;
          push?: boolean;
          push_enviado_at?: string | null;
          tipo?: string;
          titulo?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      obra_etapas: {
        Row: {
          etapa: string;
          obra_id: number;
          orden: number;
        };
        ComputedFields: never;
        Insert: {
          etapa: string;
          obra_id: number;
          orden: number;
        };
        Update: {
          etapa?: string;
          obra_id?: number;
          orden?: number;
        };
        Relationships: [
          {
            foreignKeyName: "obra_etapas_etapa_fkey";
            columns: ["etapa"];
            isOneToOne: false;
            referencedRelation: "etapas";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "obra_etapas_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
        ];
      };
      obras: {
        Row: {
          cerrada_at: string | null;
          cerrada_by: string | null;
          direccion: string | null;
          empresa_id: number;
          estado: string;
          id: number;
          nombre: string;
          presupuesto_estado: string;
          presupuesto_publicado_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          cerrada_at?: string | null;
          cerrada_by?: string | null;
          direccion?: string | null;
          empresa_id: number;
          estado?: string;
          id?: number;
          nombre: string;
          presupuesto_estado?: string;
          presupuesto_publicado_at?: string | null;
        };
        Update: {
          cerrada_at?: string | null;
          cerrada_by?: string | null;
          direccion?: string | null;
          empresa_id?: number;
          estado?: string;
          id?: number;
          nombre?: string;
          presupuesto_estado?: string;
          presupuesto_publicado_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "obras_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      oc_items: {
        Row: {
          aprobado_por: string | null;
          cantidad: number;
          comprobante_id: number | null;
          created_at: string;
          id: number;
          numero_oc: string;
          obra_id: number;
          partida_id: number;
          precio_fijado_at: string | null;
          pu_aprobado: number | null;
          pu_bruto: number | null;
          pu_cotizado: number | null;
          pu_fijado: number | null;
          ret_garantia_pct: number;
          tol_fijada: number | null;
        };
        ComputedFields: never;
        Insert: {
          aprobado_por?: string | null;
          cantidad: number;
          comprobante_id?: number | null;
          created_at?: string;
          id?: number;
          numero_oc: string;
          obra_id: number;
          partida_id: number;
          precio_fijado_at?: string | null;
          pu_aprobado?: number | null;
          pu_bruto?: number | null;
          pu_cotizado?: number | null;
          pu_fijado?: number | null;
          ret_garantia_pct?: number;
          tol_fijada?: number | null;
        };
        Update: {
          aprobado_por?: string | null;
          cantidad?: number;
          comprobante_id?: number | null;
          created_at?: string;
          id?: number;
          numero_oc?: string;
          obra_id?: number;
          partida_id?: number;
          precio_fijado_at?: string | null;
          pu_aprobado?: number | null;
          pu_bruto?: number | null;
          pu_cotizado?: number | null;
          pu_fijado?: number | null;
          ret_garantia_pct?: number;
          tol_fijada?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "comprobantes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_comprobantes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_expediente";
            referencedColumns: ["comprobante_id"];
          },
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_registro_compras";
            referencedColumns: ["comprobante_id"];
          },
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "ordenes_compra";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_ordenes";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_os_retenidas";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "partidas";
            referencedColumns: ["id", "obra_id"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "v_avance_partida";
            referencedColumns: ["partida_id", "obra_id"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "v_partidas";
            referencedColumns: ["id", "obra_id"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "v_presupuesto_efectivo";
            referencedColumns: ["partida_id", "obra_id"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "v_seguimiento_partida";
            referencedColumns: ["partida_id", "obra_id"];
          },
        ];
      };
      orden_borradores: {
        Row: {
          created_at: string;
          datos: NonNullable<Json>;
          id: number;
          obra_id: number;
          tipo: Database["public"]["Enums"]["tipo_orden"];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          datos: NonNullable<Json>;
          id?: number;
          obra_id: number;
          tipo: Database["public"]["Enums"]["tipo_orden"];
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          datos?: NonNullable<Json>;
          id?: number;
          obra_id?: number;
          tipo?: Database["public"]["Enums"]["tipo_orden"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orden_borradores_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
        ];
      };
      ordenes_compra: {
        Row: {
          comprobante_tipo:
            | Database["public"]["Enums"]["tipo_comprobante"]
            | null;
          contrato_enviado_at: string | null;
          cotizacion_enviada_at: string | null;
          cotizacion_estado: Database["public"]["Enums"]["cotizacion_estado"];
          cotizacion_recibida_at: string | null;
          created_at: string;
          created_by: string | null;
          entrega_cerrada_at: string | null;
          entrega_cerrada_by: string | null;
          entrega_cerrada_motivo: string | null;
          es_retencion: boolean;
          estado: Database["public"]["Enums"]["estado_oc"];
          fecha: string;
          fecha_inicio: string | null;
          glosa_rhe: string | null;
          historico: boolean;
          motivo_anulacion: string | null;
          numero: string;
          obra_id: number;
          proveedor_id: number;
          requiere_guia: boolean;
          retenida_en: string | null;
          tipo: Database["public"]["Enums"]["tipo_orden"];
          token_cotizacion: string | null;
          updated_at: string;
          updated_by: string | null;
          valorizacion_id: number | null;
        };
        ComputedFields: never;
        Insert: {
          comprobante_tipo?:
            | Database["public"]["Enums"]["tipo_comprobante"]
            | null;
          contrato_enviado_at?: string | null;
          cotizacion_enviada_at?: string | null;
          cotizacion_estado?: Database["public"]["Enums"]["cotizacion_estado"];
          cotizacion_recibida_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          entrega_cerrada_at?: string | null;
          entrega_cerrada_by?: string | null;
          entrega_cerrada_motivo?: string | null;
          es_retencion?: boolean;
          estado?: Database["public"]["Enums"]["estado_oc"];
          fecha?: string;
          fecha_inicio?: string | null;
          glosa_rhe?: string | null;
          historico?: boolean;
          motivo_anulacion?: string | null;
          numero: string;
          obra_id: number;
          proveedor_id: number;
          requiere_guia?: boolean;
          retenida_en?: string | null;
          tipo?: Database["public"]["Enums"]["tipo_orden"];
          token_cotizacion?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valorizacion_id?: number | null;
        };
        Update: {
          comprobante_tipo?:
            | Database["public"]["Enums"]["tipo_comprobante"]
            | null;
          contrato_enviado_at?: string | null;
          cotizacion_enviada_at?: string | null;
          cotizacion_estado?: Database["public"]["Enums"]["cotizacion_estado"];
          cotizacion_recibida_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          entrega_cerrada_at?: string | null;
          entrega_cerrada_by?: string | null;
          entrega_cerrada_motivo?: string | null;
          es_retencion?: boolean;
          estado?: Database["public"]["Enums"]["estado_oc"];
          fecha?: string;
          fecha_inicio?: string | null;
          glosa_rhe?: string | null;
          historico?: boolean;
          motivo_anulacion?: string | null;
          numero?: string;
          obra_id?: number;
          proveedor_id?: number;
          requiere_guia?: boolean;
          retenida_en?: string | null;
          tipo?: Database["public"]["Enums"]["tipo_orden"];
          token_cotizacion?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valorizacion_id?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "ordenes_compra_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ordenes_compra_proveedor_id_fkey";
            columns: ["proveedor_id"];
            isOneToOne: false;
            referencedRelation: "proveedores";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ordenes_compra_valorizacion_id_fkey";
            columns: ["valorizacion_id"];
            isOneToOne: false;
            referencedRelation: "valorizaciones";
            referencedColumns: ["id"];
          },
        ];
      };
      ordenes_pago: {
        Row: {
          concepto: string;
          created_at: string;
          created_by: string | null;
          cuenta_contable: string | null;
          estado: string;
          fecha: string;
          id: number;
          monto: number;
          motivo_anulacion: string | null;
          numero: string;
          obra_id: number;
          proveedor_id: number;
        };
        ComputedFields: never;
        Insert: {
          concepto: string;
          created_at?: string;
          created_by?: string | null;
          cuenta_contable?: string | null;
          estado?: string;
          fecha?: string;
          id?: number;
          monto: number;
          motivo_anulacion?: string | null;
          numero: string;
          obra_id: number;
          proveedor_id: number;
        };
        Update: {
          concepto?: string;
          created_at?: string;
          created_by?: string | null;
          cuenta_contable?: string | null;
          estado?: string;
          fecha?: string;
          id?: number;
          monto?: number;
          motivo_anulacion?: string | null;
          numero?: string;
          obra_id?: number;
          proveedor_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ordenes_pago_cuenta_contable_fkey";
            columns: ["cuenta_contable"];
            isOneToOne: false;
            referencedRelation: "cuentas_contables";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "ordenes_pago_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ordenes_pago_proveedor_id_fkey";
            columns: ["proveedor_id"];
            isOneToOne: false;
            referencedRelation: "proveedores";
            referencedColumns: ["id"];
          },
        ];
      };
      pago_aplicaciones: {
        Row: {
          comprobante_id: number | null;
          id: number;
          monto: number;
          numero_oc: string | null;
          obra_id: number | null;
          orden_pago_id: number | null;
          pago_id: number;
        };
        ComputedFields: never;
        Insert: {
          comprobante_id?: number | null;
          id?: number;
          monto: number;
          numero_oc?: string | null;
          obra_id?: number | null;
          orden_pago_id?: number | null;
          pago_id: number;
        };
        Update: {
          comprobante_id?: number | null;
          id?: number;
          monto?: number;
          numero_oc?: string | null;
          obra_id?: number | null;
          orden_pago_id?: number | null;
          pago_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "pago_aplicaciones_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "comprobantes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pago_aplicaciones_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_comprobantes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pago_aplicaciones_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_expediente";
            referencedColumns: ["comprobante_id"];
          },
          {
            foreignKeyName: "pago_aplicaciones_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_registro_compras";
            referencedColumns: ["comprobante_id"];
          },
          {
            foreignKeyName: "pago_aplicaciones_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "ordenes_compra";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "pago_aplicaciones_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_ordenes";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "pago_aplicaciones_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_os_retenidas";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "pago_aplicaciones_orden_pago_id_fkey";
            columns: ["orden_pago_id"];
            isOneToOne: false;
            referencedRelation: "ordenes_pago";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pago_aplicaciones_pago_id_fkey";
            columns: ["pago_id"];
            isOneToOne: false;
            referencedRelation: "pagos";
            referencedColumns: ["id"];
          },
        ];
      };
      pagos: {
        Row: {
          banco: string | null;
          created_at: string;
          created_by: string | null;
          empresa_id: number;
          fecha: string;
          historico: boolean;
          id: number;
          monto: number;
          numero_operacion: string | null;
        };
        ComputedFields: never;
        Insert: {
          banco?: string | null;
          created_at?: string;
          created_by?: string | null;
          empresa_id: number;
          fecha: string;
          historico?: boolean;
          id?: number;
          monto: number;
          numero_operacion?: string | null;
        };
        Update: {
          banco?: string | null;
          created_at?: string;
          created_by?: string | null;
          empresa_id?: number;
          fecha?: string;
          historico?: boolean;
          id?: number;
          monto?: number;
          numero_operacion?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pagos_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      parametros: {
        Row: {
          detraccion_minimo: number;
          id: boolean;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          detraccion_minimo?: number;
          id?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          detraccion_minimo?: number;
          id?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      partidas: {
        Row: {
          cantidad: number;
          codigo: string;
          dada_de_baja_at: string | null;
          etapa: string;
          id: number;
          item_id: number;
          obra_id: number;
          pu: number | null;
          requerimiento: string;
          faltante: number | null;
        };
        ComputedFields: "faltante";
        Insert: {
          cantidad?: number;
          codigo?: string;
          dada_de_baja_at?: string | null;
          etapa: string;
          id?: number;
          item_id: number;
          obra_id: number;
          pu?: number | null;
          requerimiento?: string;
        };
        Update: {
          cantidad?: number;
          codigo?: string;
          dada_de_baja_at?: string | null;
          etapa?: string;
          id?: number;
          item_id?: number;
          obra_id?: number;
          pu?: number | null;
          requerimiento?: string;
        };
        Relationships: [
          {
            foreignKeyName: "partidas_etapa_fkey";
            columns: ["etapa"];
            isOneToOne: false;
            referencedRelation: "etapas";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "v_items_sin_cuenta";
            referencedColumns: ["item_id"];
          },
          {
            foreignKeyName: "partidas_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partidas_requerimiento_fkey";
            columns: ["requerimiento"];
            isOneToOne: false;
            referencedRelation: "requerimientos";
            referencedColumns: ["codigo"];
          },
        ];
      };
      perfil_obras: {
        Row: {
          obra_id: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          obra_id: number;
          user_id: string;
        };
        Update: {
          obra_id?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "perfil_obras_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
        ];
      };
      perfil_privado: {
        Row: {
          dni: string | null;
          firma_at: string | null;
          firma_path: string | null;
          telefono: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          dni?: string | null;
          firma_at?: string | null;
          firma_path?: string | null;
          telefono?: string | null;
          user_id: string;
        };
        Update: {
          dni?: string | null;
          firma_at?: string | null;
          firma_path?: string | null;
          telefono?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      perfil_roles: {
        Row: {
          rol: Database["public"]["Enums"]["rol"];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          rol: Database["public"]["Enums"]["rol"];
          user_id: string;
        };
        Update: {
          rol?: Database["public"]["Enums"]["rol"];
          user_id?: string;
        };
        Relationships: [];
      };
      perfiles: {
        Row: {
          apellidos: string | null;
          nombre: string;
          nombres: string | null;
          rol: Database["public"]["Enums"]["rol"];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          apellidos?: string | null;
          nombre: string;
          nombres?: string | null;
          rol?: Database["public"]["Enums"]["rol"];
          user_id: string;
        };
        Update: {
          apellidos?: string | null;
          nombre?: string;
          nombres?: string | null;
          rol?: Database["public"]["Enums"]["rol"];
          user_id?: string;
        };
        Relationships: [];
      };
      personas: {
        Row: {
          cargo: string;
          correo: string | null;
          created_at: string;
          created_by: string | null;
          dni: string;
          estado: string;
          id: number;
          nombre: string;
          telefono: string | null;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          cargo: string;
          correo?: string | null;
          created_at?: string;
          created_by?: string | null;
          dni: string;
          estado?: string;
          id?: number;
          nombre: string;
          telefono?: string | null;
          user_id?: string | null;
        };
        Update: {
          cargo?: string;
          correo?: string | null;
          created_at?: string;
          created_by?: string | null;
          dni?: string;
          estado?: string;
          id?: number;
          nombre?: string;
          telefono?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      proveedor_contactos: {
        Row: {
          created_at: string;
          id: number;
          nombre: string | null;
          proveedor_id: number;
          telefono: string;
          telegram: boolean;
          whatsapp: boolean;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: number;
          nombre?: string | null;
          proveedor_id: number;
          telefono: string;
          telegram?: boolean;
          whatsapp?: boolean;
        };
        Update: {
          created_at?: string;
          id?: number;
          nombre?: string | null;
          proveedor_id?: number;
          telefono?: string;
          telegram?: boolean;
          whatsapp?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "proveedor_contactos_proveedor_id_fkey";
            columns: ["proveedor_id"];
            isOneToOne: false;
            referencedRelation: "proveedores";
            referencedColumns: ["id"];
          },
        ];
      };
      proveedor_cuentas: {
        Row: {
          banco: string | null;
          cuenta_bancaria: string | null;
          proveedor_id: number;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          banco?: string | null;
          cuenta_bancaria?: string | null;
          proveedor_id: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          banco?: string | null;
          cuenta_bancaria?: string | null;
          proveedor_id?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "proveedor_cuentas_proveedor_id_fkey";
            columns: ["proveedor_id"];
            isOneToOne: true;
            referencedRelation: "proveedores";
            referencedColumns: ["id"];
          },
        ];
      };
      proveedor_tipos_material: {
        Row: {
          proveedor_id: number;
          tipo_material: string;
        };
        ComputedFields: never;
        Insert: {
          proveedor_id: number;
          tipo_material: string;
        };
        Update: {
          proveedor_id?: number;
          tipo_material?: string;
        };
        Relationships: [
          {
            foreignKeyName: "proveedor_tipos_material_proveedor_id_fkey";
            columns: ["proveedor_id"];
            isOneToOne: false;
            referencedRelation: "proveedores";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proveedor_tipos_material_tipo_material_fkey";
            columns: ["tipo_material"];
            isOneToOne: false;
            referencedRelation: "tipos_material";
            referencedColumns: ["codigo"];
          },
        ];
      };
      proveedores: {
        Row: {
          comprobante_excel: string | null;
          comprobante_habitual:
            | Database["public"]["Enums"]["tipo_comprobante"]
            | null;
          id: number;
          razon_social: string;
          retencion_4ta_pct: number;
          ruc_o_cod: string;
          suspension_4ta_fecha: string | null;
          suspension_4ta_operacion: string | null;
          suspension_4ta_path: string | null;
        };
        ComputedFields: never;
        Insert: {
          comprobante_excel?: string | null;
          comprobante_habitual?:
            | Database["public"]["Enums"]["tipo_comprobante"]
            | null;
          id?: number;
          razon_social: string;
          retencion_4ta_pct?: number;
          ruc_o_cod: string;
          suspension_4ta_fecha?: string | null;
          suspension_4ta_operacion?: string | null;
          suspension_4ta_path?: string | null;
        };
        Update: {
          comprobante_excel?: string | null;
          comprobante_habitual?:
            | Database["public"]["Enums"]["tipo_comprobante"]
            | null;
          id?: number;
          razon_social?: string;
          retencion_4ta_pct?: number;
          ruc_o_cod?: string;
          suspension_4ta_fecha?: string | null;
          suspension_4ta_operacion?: string | null;
          suspension_4ta_path?: string | null;
        };
        Relationships: [];
      };
      push_suscripciones: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: number;
          p256dh: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: number;
          p256dh: string;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: number;
          p256dh?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      rechazos: {
        Row: {
          comprobantes_anulados: string[] | null;
          correccion: string | null;
          created_at: string;
          created_by: string | null;
          doc: string;
          estado_destino: string;
          estado_previo: string;
          id: number;
          motivo: string | null;
          nota_reenvio: string | null;
          numero: string | null;
          obra_id: number | null;
          orden_pago_id: number | null;
          reenviado_at: string | null;
          reenviado_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          comprobantes_anulados?: string[] | null;
          correccion?: string | null;
          created_at?: string;
          created_by?: string | null;
          doc: string;
          estado_destino: string;
          estado_previo: string;
          id?: number;
          motivo?: string | null;
          nota_reenvio?: string | null;
          numero?: string | null;
          obra_id?: number | null;
          orden_pago_id?: number | null;
          reenviado_at?: string | null;
          reenviado_by?: string | null;
        };
        Update: {
          comprobantes_anulados?: string[] | null;
          correccion?: string | null;
          created_at?: string;
          created_by?: string | null;
          doc?: string;
          estado_destino?: string;
          estado_previo?: string;
          id?: number;
          motivo?: string | null;
          nota_reenvio?: string | null;
          numero?: string | null;
          obra_id?: number | null;
          orden_pago_id?: number | null;
          reenviado_at?: string | null;
          reenviado_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "rechazos_obra_id_numero_fkey";
            columns: ["obra_id", "numero"];
            isOneToOne: false;
            referencedRelation: "ordenes_compra";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "rechazos_obra_id_numero_fkey";
            columns: ["obra_id", "numero"];
            isOneToOne: false;
            referencedRelation: "v_ordenes";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "rechazos_obra_id_numero_fkey";
            columns: ["obra_id", "numero"];
            isOneToOne: false;
            referencedRelation: "v_os_retenidas";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "rechazos_orden_pago_id_fkey";
            columns: ["orden_pago_id"];
            isOneToOne: false;
            referencedRelation: "ordenes_pago";
            referencedColumns: ["id"];
          },
        ];
      };
      requerimientos: {
        Row: {
          codigo: string;
          orden: number;
        };
        ComputedFields: never;
        Insert: {
          codigo: string;
          orden?: number;
        };
        Update: {
          codigo?: string;
          orden?: number;
        };
        Relationships: [];
      };
      requerimientos_obra: {
        Row: {
          anulado_at: string | null;
          anulado_by: string | null;
          created_at: string;
          created_by: string;
          estado: string;
          id: number;
          motivo_anulacion: string | null;
          nota: string | null;
          numero: string;
          obra_id: number;
        };
        ComputedFields: never;
        Insert: {
          anulado_at?: string | null;
          anulado_by?: string | null;
          created_at?: string;
          created_by?: string;
          estado?: string;
          id?: number;
          motivo_anulacion?: string | null;
          nota?: string | null;
          numero: string;
          obra_id: number;
        };
        Update: {
          anulado_at?: string | null;
          anulado_by?: string | null;
          created_at?: string;
          created_by?: string;
          estado?: string;
          id?: number;
          motivo_anulacion?: string | null;
          nota?: string | null;
          numero?: string;
          obra_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "requerimientos_obra_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
        ];
      };
      requerimientos_obra_items: {
        Row: {
          cantidad: number;
          id: number;
          partida_id: number;
          requerimiento_id: number;
        };
        ComputedFields: never;
        Insert: {
          cantidad: number;
          id?: number;
          partida_id: number;
          requerimiento_id: number;
        };
        Update: {
          cantidad?: number;
          id?: number;
          partida_id?: number;
          requerimiento_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "requerimientos_obra_items_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "partidas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "requerimientos_obra_items_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_avance_partida";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "requerimientos_obra_items_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_partidas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "requerimientos_obra_items_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_presupuesto_efectivo";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "requerimientos_obra_items_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_seguimiento_partida";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "requerimientos_obra_items_requerimiento_id_fkey";
            columns: ["requerimiento_id"];
            isOneToOne: false;
            referencedRelation: "requerimientos_obra";
            referencedColumns: ["id"];
          },
        ];
      };
      retenciones: {
        Row: {
          item_id: number;
          obra_id: number;
          porcentaje: number;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          item_id: number;
          obra_id: number;
          porcentaje?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          item_id?: number;
          obra_id?: number;
          porcentaje?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "retenciones_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "retenciones_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "v_items_sin_cuenta";
            referencedColumns: ["item_id"];
          },
          {
            foreignKeyName: "retenciones_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
        ];
      };
      sesiones_bloqueo: {
        Row: {
          created_at: string;
          desbloqueado_hasta: string;
          session_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          desbloqueado_hasta: string;
          session_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          desbloqueado_hasta?: string;
          session_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      solicitud_adjuntos: {
        Row: {
          created_at: string;
          created_by: string;
          id: number;
          mime: string | null;
          nombre: string;
          path: string;
          solicitud_id: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string;
          id?: number;
          mime?: string | null;
          nombre: string;
          path: string;
          solicitud_id: number;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: number;
          mime?: string | null;
          nombre?: string;
          path?: string;
          solicitud_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "solicitud_adjuntos_solicitud_id_fkey";
            columns: ["solicitud_id"];
            isOneToOne: false;
            referencedRelation: "solicitudes";
            referencedColumns: ["id"];
          },
        ];
      };
      solicitudes: {
        Row: {
          datos: Json | null;
          estado: string;
          id: number;
          motivo: string | null;
          obra_id: number | null;
          partida_id: number | null;
          persona_id: number | null;
          respuesta: string | null;
          resuelto_at: string | null;
          resuelto_by: string | null;
          revisado_at: string | null;
          revisado_by: string | null;
          revision: string | null;
          solicitado_at: string;
          solicitado_by: string;
          tipo: string;
        };
        ComputedFields: never;
        Insert: {
          datos?: Json | null;
          estado?: string;
          id?: number;
          motivo?: string | null;
          obra_id?: number | null;
          partida_id?: number | null;
          persona_id?: number | null;
          respuesta?: string | null;
          resuelto_at?: string | null;
          resuelto_by?: string | null;
          revisado_at?: string | null;
          revisado_by?: string | null;
          revision?: string | null;
          solicitado_at?: string;
          solicitado_by?: string;
          tipo: string;
        };
        Update: {
          datos?: Json | null;
          estado?: string;
          id?: number;
          motivo?: string | null;
          obra_id?: number | null;
          partida_id?: number | null;
          persona_id?: number | null;
          respuesta?: string | null;
          resuelto_at?: string | null;
          resuelto_by?: string | null;
          revisado_at?: string | null;
          revisado_by?: string | null;
          revision?: string | null;
          solicitado_at?: string;
          solicitado_by?: string;
          tipo?: string;
        };
        Relationships: [
          {
            foreignKeyName: "solicitudes_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "solicitudes_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "partidas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "solicitudes_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_avance_partida";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "solicitudes_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_partidas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "solicitudes_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_presupuesto_efectivo";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "solicitudes_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_seguimiento_partida";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "solicitudes_persona_id_fkey";
            columns: ["persona_id"];
            isOneToOne: false;
            referencedRelation: "personas";
            referencedColumns: ["id"];
          },
        ];
      };
      sugerencias: {
        Row: {
          capturas: string[];
          created_at: string;
          id: number;
          pantalla: string | null;
          rol: string;
          ruta: string | null;
          texto: string;
          tipo: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          capturas?: string[];
          created_at?: string;
          id?: never;
          pantalla?: string | null;
          rol: string;
          ruta?: string | null;
          texto: string;
          tipo: string;
          user_id?: string | null;
        };
        Update: {
          capturas?: string[];
          created_at?: string;
          id?: never;
          pantalla?: string | null;
          rol?: string;
          ruta?: string | null;
          texto?: string;
          tipo?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      suspensiones_4ta: {
        Row: {
          fecha: string;
          numero_operacion: string;
          ruc: string;
        };
        ComputedFields: never;
        Insert: {
          fecha: string;
          numero_operacion: string;
          ruc: string;
        };
        Update: {
          fecha?: string;
          numero_operacion?: string;
          ruc?: string;
        };
        Relationships: [];
      };
      tipos_material: {
        Row: {
          codigo: string;
          orden: number;
        };
        ComputedFields: never;
        Insert: {
          codigo: string;
          orden?: number;
        };
        Update: {
          codigo?: string;
          orden?: number;
        };
        Relationships: [];
      };
      transportistas: {
        Row: {
          created_at: string;
          id: number;
          licencia: string | null;
          placa: string | null;
          razon_social: string;
          ruc: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: number;
          licencia?: string | null;
          placa?: string | null;
          razon_social: string;
          ruc: string;
        };
        Update: {
          created_at?: string;
          id?: number;
          licencia?: string | null;
          placa?: string | null;
          razon_social?: string;
          ruc?: string;
        };
        Relationships: [];
      };
      valorizacion_partidas: {
        Row: {
          cantidad: number;
          parcial: number | null;
          partida_id: number;
          porcentaje: number;
          pu: number;
          retencion: number | null;
          valorizacion_id: number;
        };
        ComputedFields: never;
        Insert: {
          cantidad: number;
          parcial?: never;
          partida_id: number;
          porcentaje: number;
          pu: number;
          retencion?: never;
          valorizacion_id: number;
        };
        Update: {
          cantidad?: number;
          parcial?: never;
          partida_id?: number;
          porcentaje?: number;
          pu?: number;
          retencion?: never;
          valorizacion_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "valorizacion_partidas_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "partidas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "valorizacion_partidas_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_avance_partida";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "valorizacion_partidas_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_partidas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "valorizacion_partidas_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_presupuesto_efectivo";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "valorizacion_partidas_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_seguimiento_partida";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "valorizacion_partidas_valorizacion_id_fkey";
            columns: ["valorizacion_id"];
            isOneToOne: false;
            referencedRelation: "valorizaciones";
            referencedColumns: ["id"];
          },
        ];
      };
      valorizaciones: {
        Row: {
          created_at: string;
          created_by: string;
          fecha_corte: string;
          id: number;
          numero: number;
          numero_oc: string | null;
          obra_id: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string;
          fecha_corte?: string;
          id?: number;
          numero: number;
          numero_oc?: string | null;
          obra_id: number;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          fecha_corte?: string;
          id?: number;
          numero?: number;
          numero_oc?: string | null;
          obra_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "valorizaciones_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      v_avance_partida: {
        Row: {
          comprado: number | null;
          descripcion: string;
          etapa: string;
          fotos: number | null;
          item_id: number;
          llegado: number | null;
          monto_comprado: number | null;
          obra_id: number;
          parcial: number | null;
          partida_id: number;
          presupuestado: number;
          pu: number | null;
          requerimiento: string;
          rubro: Database["public"]["Enums"]["rubro"];
          unidad: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "partidas_etapa_fkey";
            columns: ["etapa"];
            isOneToOne: false;
            referencedRelation: "etapas";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "v_items_sin_cuenta";
            referencedColumns: ["item_id"];
          },
          {
            foreignKeyName: "partidas_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partidas_requerimiento_fkey";
            columns: ["requerimiento"];
            isOneToOne: false;
            referencedRelation: "requerimientos";
            referencedColumns: ["codigo"];
          },
        ];
      };
      v_comprobantes: {
        Row: {
          archivo_path: string | null;
          asiento_id: number | null;
          base: number;
          comprobante: string | null;
          created_at: string;
          detraccion: number;
          empresa: string;
          empresa_id: number;
          empresa_ruc: string | null;
          fecha_emision: string;
          id: number;
          igv: number;
          neto: number | null;
          numero: string;
          pagado: number | null;
          proveedor: string;
          proveedor_id: number;
          proveedor_ruc: string;
          retencion: number;
          saldo: number | null;
          serie: string;
          tipo: Database["public"]["Enums"]["tipo_comprobante"];
          total: number;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "comprobantes_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comprobantes_proveedor_id_fkey";
            columns: ["proveedor_id"];
            isOneToOne: false;
            referencedRelation: "proveedores";
            referencedColumns: ["id"];
          },
        ];
      };
      v_entregas_item: {
        Row: {
          entregado: number | null;
          numero_oc: string;
          obra_id: number;
          oc_item_id: number;
          pedido: number;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "ordenes_compra";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_ordenes";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_os_retenidas";
            referencedColumns: ["obra_id", "numero"];
          },
        ];
      };
      v_entregas_partida: {
        Row: {
          cantidad: number;
          created_at: string;
          id: number;
          obra_id: number;
          observacion: string | null;
          partida_id: number;
          rol: string;
        };
        ComputedFields: never;
        Relationships: [];
      };
      v_expediente: {
        Row: {
          comprobante_id: number;
          docs_ok: number | null;
          docs_req: number | null;
          empresa_id: number;
          numero: string;
          numero_oc: string | null;
          obra_id: number | null;
          ordenes: string | null;
          periodo: string | null;
          proveedor: string;
          requiere_contrato: boolean | null;
          serie: string;
          tiene_archivo: boolean | null;
          tiene_contrato: boolean | null;
          tiene_fotos: boolean | null;
          tiene_guia: boolean | null;
          tiene_orden: boolean | null;
          tiene_voucher: boolean | null;
          tipo: Database["public"]["Enums"]["tipo_comprobante"];
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "comprobantes_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      v_items_sin_cuenta: {
        Row: {
          descripcion: string;
          item_id: number;
          monto_comprado: number | null;
          n_oc_items: number | null;
          n_partidas: number | null;
          numero: number | null;
          rubro: Database["public"]["Enums"]["rubro"];
          unidad: string | null;
        };
        ComputedFields: never;
        Relationships: [];
      };
      v_oc_items: {
        Row: {
          alerta: string | null;
          aprobado_por: string | null;
          cantidad: number;
          comprobante: string | null;
          comprobante_id: number | null;
          cuenta_contable: string | null;
          descripcion: string;
          dif: number | null;
          estado: Database["public"]["Enums"]["estado_oc"];
          etapa: string;
          fecha: string;
          id: number;
          item_id: number;
          numero_oc: string;
          obra_id: number;
          parcial: number | null;
          partida_codigo: string;
          partida_id: number;
          pu_aprobado: number | null;
          pu_bruto: number | null;
          pu_cotizado: number | null;
          pu_efectivo: number | null;
          pu_hist: number | null;
          pu_max: number | null;
          pu_partida: number | null;
          requerimiento: string;
          ret_garantia_pct: number;
          retenido: number | null;
          rubro: Database["public"]["Enums"]["rubro"];
          tipo_material: string | null;
          unidad: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "items_cuenta_contable_fkey";
            columns: ["cuenta_contable"];
            isOneToOne: false;
            referencedRelation: "cuentas_contables";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "items_tipo_material_fkey";
            columns: ["tipo_material"];
            isOneToOne: false;
            referencedRelation: "tipos_material";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "comprobantes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_comprobantes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_expediente";
            referencedColumns: ["comprobante_id"];
          },
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_registro_compras";
            referencedColumns: ["comprobante_id"];
          },
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "ordenes_compra";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_ordenes";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_os_retenidas";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "partidas";
            referencedColumns: ["id", "obra_id"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "v_avance_partida";
            referencedColumns: ["partida_id", "obra_id"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "v_partidas";
            referencedColumns: ["id", "obra_id"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "v_presupuesto_efectivo";
            referencedColumns: ["partida_id", "obra_id"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "v_seguimiento_partida";
            referencedColumns: ["partida_id", "obra_id"];
          },
          {
            foreignKeyName: "partidas_etapa_fkey";
            columns: ["etapa"];
            isOneToOne: false;
            referencedRelation: "etapas";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "v_items_sin_cuenta";
            referencedColumns: ["item_id"];
          },
          {
            foreignKeyName: "partidas_requerimiento_fkey";
            columns: ["requerimiento"];
            isOneToOne: false;
            referencedRelation: "requerimientos";
            referencedColumns: ["codigo"];
          },
        ];
      };
      v_oc_items_calc: {
        Row: {
          aprobado_por: string | null;
          cantidad: number;
          comprobante_id: number | null;
          created_at: string;
          cuenta_contable: string | null;
          descripcion: string;
          es_retencion: boolean;
          estado: Database["public"]["Enums"]["estado_oc"];
          etapa: string;
          fecha: string;
          id: number;
          item_id: number;
          numero_oc: string;
          obra_id: number;
          parcial: number | null;
          partida_codigo: string;
          partida_id: number;
          proveedor_id: number;
          pu_aprobado: number | null;
          pu_bruto: number | null;
          pu_cotizado: number | null;
          pu_efectivo: number | null;
          pu_max: number | null;
          pu_partida: number | null;
          requerimiento: string;
          ret_garantia_pct: number;
          retenida_en: string | null;
          retenido: number | null;
          rubro: Database["public"]["Enums"]["rubro"];
          sobreprecio: boolean | null;
          tipo: Database["public"]["Enums"]["tipo_orden"];
          tipo_material: string | null;
          tolerancia_pct: number | null;
          unidad: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "items_cuenta_contable_fkey";
            columns: ["cuenta_contable"];
            isOneToOne: false;
            referencedRelation: "cuentas_contables";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "items_tipo_material_fkey";
            columns: ["tipo_material"];
            isOneToOne: false;
            referencedRelation: "tipos_material";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "comprobantes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_comprobantes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_expediente";
            referencedColumns: ["comprobante_id"];
          },
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_registro_compras";
            referencedColumns: ["comprobante_id"];
          },
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "ordenes_compra";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_ordenes";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_os_retenidas";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "partidas";
            referencedColumns: ["id", "obra_id"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "v_avance_partida";
            referencedColumns: ["partida_id", "obra_id"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "v_partidas";
            referencedColumns: ["id", "obra_id"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "v_presupuesto_efectivo";
            referencedColumns: ["partida_id", "obra_id"];
          },
          {
            foreignKeyName: "oc_items_partida_id_obra_id_fkey";
            columns: ["partida_id", "obra_id"];
            isOneToOne: false;
            referencedRelation: "v_seguimiento_partida";
            referencedColumns: ["partida_id", "obra_id"];
          },
          {
            foreignKeyName: "ordenes_compra_proveedor_id_fkey";
            columns: ["proveedor_id"];
            isOneToOne: false;
            referencedRelation: "proveedores";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partidas_etapa_fkey";
            columns: ["etapa"];
            isOneToOne: false;
            referencedRelation: "etapas";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "v_items_sin_cuenta";
            referencedColumns: ["item_id"];
          },
          {
            foreignKeyName: "partidas_requerimiento_fkey";
            columns: ["requerimiento"];
            isOneToOne: false;
            referencedRelation: "requerimientos";
            referencedColumns: ["codigo"];
          },
        ];
      };
      v_orden_comprobantes: {
        Row: {
          comprobante_id: number | null;
          factor: number | null;
          fecha_emision: string;
          neto: number | null;
          neto_orden: number | null;
          numero_oc: string;
          obra_id: number;
          pagado: number | null;
          pagado_orden: number | null;
          parcial: number | null;
          saldo: number | null;
          saldo_orden: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "comprobantes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_comprobantes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_expediente";
            referencedColumns: ["comprobante_id"];
          },
          {
            foreignKeyName: "oc_items_comprobante_id_fkey";
            columns: ["comprobante_id"];
            isOneToOne: false;
            referencedRelation: "v_registro_compras";
            referencedColumns: ["comprobante_id"];
          },
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "ordenes_compra";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_ordenes";
            referencedColumns: ["obra_id", "numero"];
          },
          {
            foreignKeyName: "oc_items_obra_id_numero_oc_fkey";
            columns: ["obra_id", "numero_oc"];
            isOneToOne: false;
            referencedRelation: "v_os_retenidas";
            referencedColumns: ["obra_id", "numero"];
          },
        ];
      };
      v_ordenes: {
        Row: {
          contrato_enviado_at: string | null;
          created_at: string;
          empresa: string;
          empresa_id: number;
          empresa_ruc: string | null;
          estado: Database["public"]["Enums"]["estado_oc"];
          etapas: string[] | null;
          facturado: number | null;
          fecha: string;
          glosa_rhe: string | null;
          has_alertas: boolean | null;
          items_busqueda: string | null;
          motivo_anulacion: string | null;
          n_items: number | null;
          numero: string;
          obra: string;
          obra_id: number;
          pagado: number | null;
          proveedor: string;
          proveedor_id: number;
          proveedor_ruc: string;
          tipo: Database["public"]["Enums"]["tipo_orden"];
          tipos_material: string[] | null;
          token_cotizacion: string | null;
          total: number | null;
          updated_at: string;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "obras_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ordenes_compra_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ordenes_compra_proveedor_id_fkey";
            columns: ["proveedor_id"];
            isOneToOne: false;
            referencedRelation: "proveedores";
            referencedColumns: ["id"];
          },
        ];
      };
      v_os_retenidas: {
        Row: {
          devolucion_estado: Database["public"]["Enums"]["estado_oc"] | null;
          estado: Database["public"]["Enums"]["estado_oc"];
          fecha: string;
          neto: number | null;
          numero: string;
          obra: string;
          obra_estado: string;
          obra_id: number;
          pagada: boolean | null;
          proveedor: string;
          proveedor_id: number;
          proveedor_ruc: string;
          retenida_en: string | null;
          retenido: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "ordenes_compra_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ordenes_compra_proveedor_id_fkey";
            columns: ["proveedor_id"];
            isOneToOne: false;
            referencedRelation: "proveedores";
            referencedColumns: ["id"];
          },
        ];
      };
      v_partidas: {
        Row: {
          adelanto_dado: number | null;
          adelanto_recibido: number | null;
          avance: number | null;
          cant_comprometida: number | null;
          cantidad: number;
          cantidad_efectiva: number | null;
          codigo: string;
          descripcion: string;
          empresa_id: number;
          etapa: string;
          id: number;
          item_id: number;
          monto_ejecutado: number | null;
          obra: string;
          obra_id: number;
          parcial: number | null;
          pu: number | null;
          pu_max: number | null;
          requerimiento: string;
          rubro: Database["public"]["Enums"]["rubro"];
          saldo_cant: number | null;
          saldo_monto: number | null;
          tipo_material: string | null;
          unidad: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "items_tipo_material_fkey";
            columns: ["tipo_material"];
            isOneToOne: false;
            referencedRelation: "tipos_material";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "obras_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partidas_etapa_fkey";
            columns: ["etapa"];
            isOneToOne: false;
            referencedRelation: "etapas";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "v_items_sin_cuenta";
            referencedColumns: ["item_id"];
          },
          {
            foreignKeyName: "partidas_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partidas_requerimiento_fkey";
            columns: ["requerimiento"];
            isOneToOne: false;
            referencedRelation: "requerimientos";
            referencedColumns: ["codigo"];
          },
        ];
      };
      v_pendientes_pago: {
        Row: {
          banco: string | null;
          comprobante_id: number | null;
          cuenta_bancaria: string | null;
          empresa: string | null;
          empresa_id: number | null;
          fecha: string | null;
          numero: string | null;
          numero_oc: string | null;
          obra_id: number | null;
          obras: string | null;
          ordenes: string | null;
          origen: string | null;
          pagado: number | null;
          proveedor: string | null;
          proveedor_id: number | null;
          retencion: number | null;
          ruc: string | null;
          saldo: number | null;
          serie: string | null;
          tipo: Database["public"]["Enums"]["tipo_comprobante"] | null;
          total: number | null;
        };
        ComputedFields: never;
        Relationships: [];
      };
      v_por_pagar: {
        Row: {
          banco: string | null;
          cuenta_bancaria: string | null;
          doc: string | null;
          empresa: string | null;
          empresa_id: number | null;
          estado: string | null;
          etapas: string[] | null;
          falta_comprobante: boolean | null;
          falta_guia: boolean | null;
          fecha: string | null;
          n_comprobantes: number | null;
          numero: string | null;
          obra: string | null;
          obra_id: number | null;
          orden_pago_id: number | null;
          pagado: number | null;
          proveedor: string | null;
          proveedor_id: number | null;
          ruc: string | null;
          saldo: number | null;
          tiene_contrato: boolean | null;
          total: number | null;
        };
        ComputedFields: never;
        Relationships: [];
      };
      v_precio_historico_item: {
        Row: {
          item_id: number;
          n_compras: number | null;
          pu_max_hist: number | null;
          pu_min: number | null;
          pu_promedio: number | null;
          ultima_fecha: string | null;
          ultimo_pu: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "v_items_sin_cuenta";
            referencedColumns: ["item_id"];
          },
        ];
      };
      v_presupuesto_efectivo: {
        Row: {
          cantidad: number;
          dado: number | null;
          efectivo: number | null;
          etapa: string;
          item_id: number;
          obra_id: number;
          partida_id: number;
          recibido: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "partidas_etapa_fkey";
            columns: ["etapa"];
            isOneToOne: false;
            referencedRelation: "etapas";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "v_items_sin_cuenta";
            referencedColumns: ["item_id"];
          },
          {
            foreignKeyName: "partidas_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
        ];
      };
      v_rechazos: {
        Row: {
          created_at: string;
          doc: string;
          empresa_id: number;
          id: number;
          motivo: string | null;
          numero: string | null;
          obra: string;
          obra_id: number | null;
          orden_pago_id: number | null;
          proveedor: string;
          ruc: string;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "obras_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rechazos_orden_pago_id_fkey";
            columns: ["orden_pago_id"];
            isOneToOne: false;
            referencedRelation: "ordenes_pago";
            referencedColumns: ["id"];
          },
        ];
      };
      v_registro_compras: {
        Row: {
          asiento_id: number | null;
          base: number;
          comprobante_id: number;
          cuo: string | null;
          destino_igv: string;
          empresa: string;
          empresa_id: number;
          empresa_ruc: string | null;
          estado_ple: string | null;
          fecha_emision: string;
          igv: number;
          items_sin_cuenta: number | null;
          numero: string;
          periodo: string | null;
          periodo_emision: string | null;
          proveedor: string;
          proveedor_id: number;
          proveedor_ruc: string;
          retencion: number;
          serie: string;
          tipo: Database["public"]["Enums"]["tipo_comprobante"];
          total: number;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "comprobantes_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comprobantes_proveedor_id_fkey";
            columns: ["proveedor_id"];
            isOneToOne: false;
            referencedRelation: "proveedores";
            referencedColumns: ["id"];
          },
        ];
      };
      v_requerimiento_items: {
        Row: {
          atendido: number | null;
          created_at: string;
          descripcion: string;
          etapa: string;
          grupo: string | null;
          id: number;
          numero: string;
          obra_id: number;
          orden_etapa: number | null;
          partida_id: number;
          pendiente: number | null;
          requerido: number;
          requerimiento_id: number;
          rubro: Database["public"]["Enums"]["rubro"];
          unidad: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "partidas_etapa_fkey";
            columns: ["etapa"];
            isOneToOne: false;
            referencedRelation: "etapas";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "requerimientos_obra_items_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "partidas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "requerimientos_obra_items_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_avance_partida";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "requerimientos_obra_items_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_partidas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "requerimientos_obra_items_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_presupuesto_efectivo";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "requerimientos_obra_items_partida_id_fkey";
            columns: ["partida_id"];
            isOneToOne: false;
            referencedRelation: "v_seguimiento_partida";
            referencedColumns: ["partida_id"];
          },
          {
            foreignKeyName: "requerimientos_obra_items_requerimiento_id_fkey";
            columns: ["requerimiento_id"];
            isOneToOne: false;
            referencedRelation: "requerimientos_obra";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "requerimientos_obra_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
        ];
      };
      v_resumen_obra: {
        Row: {
          adicionales: string[] | null;
          monto: number | null;
          obra_id: number;
          partidas: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "partidas_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
        ];
      };
      v_retencion_obra: {
        Row: {
          numero_oc: string | null;
          obra_id: number;
          retencion: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "valorizaciones_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
        ];
      };
      v_seguimiento_partida: {
        Row: {
          adelanto_dado: number | null;
          adelanto_recibido: number | null;
          descripcion: string;
          ejecutado_sin_valorizar: number | null;
          en_logistica: number | null;
          en_tesoreria: number | null;
          etapa: string;
          grupo: string | null;
          item_id: number;
          obra_id: number;
          orden_etapa: number | null;
          partida_id: number;
          por_pedir: number | null;
          por_recibir: number | null;
          presupuestado: number;
          presupuesto_efectivo: number | null;
          pu: number | null;
          recibido: number | null;
          requerido: number | null;
          requerimiento: string;
          retencion_acumulada: number | null;
          rubro: Database["public"]["Enums"]["rubro"];
          unidad: string | null;
          valorizado_pagado: number | null;
          valorizado_sin_pagar: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "partidas_etapa_fkey";
            columns: ["etapa"];
            isOneToOne: false;
            referencedRelation: "etapas";
            referencedColumns: ["codigo"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partidas_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "v_items_sin_cuenta";
            referencedColumns: ["item_id"];
          },
          {
            foreignKeyName: "partidas_obra_id_fkey";
            columns: ["obra_id"];
            isOneToOne: false;
            referencedRelation: "obras";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "partidas_requerimiento_fkey";
            columns: ["requerimiento"];
            isOneToOne: false;
            referencedRelation: "requerimientos";
            referencedColumns: ["codigo"];
          },
        ];
      };
    };
    Functions: {
      actualizar_contacto_persona: {
        Args: { p_correo: string; p_id: number; p_telefono: string };
        Returns: undefined;
      };
      actualizar_periodo_anotacion: {
        Args: { p_comprobante_id: number; p_periodo: string };
        Returns: undefined;
      };
      adjuntar_solicitud: {
        Args: { p_archivos: Json; p_solicitud_id: number };
        Returns: number;
      };
      agregar_adicional: {
        Args: { p_obra_id: number; p_partidas: Json };
        Returns: string;
      };
      anular_orden: {
        Args: { p_motivo: string; p_numero: string; p_obra_id: number };
        Returns: undefined;
      };
      anular_orden_pago: {
        Args: { p_id: number; p_motivo: string };
        Returns: undefined;
      };
      anular_requerimiento: {
        Args: { p_id: number; p_motivo: string };
        Returns: undefined;
      };
      archivo_link: {
        Args: { p_id: number; p_tipo: string; p_token: string };
        Returns: Json;
      };
      asignar_cuenta_item: {
        Args: { p_cuenta: string; p_item_id: number };
        Returns: undefined;
      };
      asignar_cuenta_items: {
        Args: { p_cuenta: string; p_ids: number[] };
        Returns: number;
      };
      asignar_persona_obra: {
        Args: { p_asignar: boolean; p_obra_id: number; p_persona_id: number };
        Returns: undefined;
      };
      bienvenida_completar: {
        Args: {
          p_apellidos: string;
          p_clave: string;
          p_dni: string;
          p_hash: string;
          p_nombres: string;
          p_telefono: string;
        };
        Returns: string;
      };
      bloqueo_activar: { Args: { p_abierta: boolean }; Returns: undefined };
      bloqueo_desbloquear: { Args: { p_session: string }; Returns: undefined };
      bloqueo_estado: { Args: Record<PropertyKey, never>; Returns: string };
      bloqueo_quitar: {
        Args: { p_session: string; p_user: string };
        Returns: undefined;
      };
      bloqueo_ventana: { Args: Record<PropertyKey, never>; Returns: string };
      cambiar_destino_igv: {
        Args: { p_comprobante_id: number; p_destino: string };
        Returns: undefined;
      };
      cambiar_rol: { Args: { p_rol: string }; Returns: undefined };
      cerrar_entrega: {
        Args: { p_motivo: string; p_numero: string; p_obra_id: number };
        Returns: undefined;
      };
      cerrar_obra: { Args: { p_obra_id: number }; Returns: number };
      confirmar_precios: {
        Args: { p_numero: string; p_obra_id: number };
        Returns: undefined;
      };
      contabilizar_comprobante: {
        Args: { p_comprobante_id: number };
        Returns: number;
      };
      contabilizar_pago: { Args: { p_pago_id: number }; Returns: number };
      contrasena_correcta: {
        Args: { p_clave: string; p_user: string };
        Returns: boolean;
      };
      crear_orden: {
        Args: {
          p_items: Json;
          p_numero: string;
          p_obra_id: number;
          p_proveedor_id: number;
          p_tipo: Database["public"]["Enums"]["tipo_orden"];
        };
        Returns: string;
      };
      crear_orden_pago: {
        Args: {
          p_concepto: string;
          p_cuenta: string;
          p_fecha: string;
          p_monto: number;
          p_obra_id: number;
          p_proveedor_id: number;
        };
        Returns: string;
      };
      crear_orden_retencion: {
        Args: { p_numero: string; p_obra_id: number; p_proveedor_id: number };
        Returns: string;
      };
      crear_orden_valorizacion: {
        Args: {
          p_numero: string;
          p_proveedor_id: number;
          p_valorizacion_id: number;
        };
        Returns: string;
      };
      crear_requerimiento: {
        Args: { p_lineas: Json; p_nota: string; p_obra_id: number };
        Returns: number;
      };
      editar_comprobante: {
        Args: {
          p_archivo_path: string;
          p_fecha: string;
          p_id: number;
          p_motivo: string;
          p_numero: string;
          p_retencion: number;
          p_serie: string;
          p_tipo: Database["public"]["Enums"]["tipo_comprobante"];
          p_total: number;
        };
        Returns: undefined;
      };
      emitir_guia: {
        Args: { p_archivo_path: string; p_id: number; p_numero_guia: string };
        Returns: undefined;
      };
      enviar_a_tesoreria: {
        Args: { p_numero: string; p_obra_id: number };
        Returns: undefined;
      };
      enviar_constancia: {
        Args: { p_numero: string; p_obra_id: number };
        Returns: undefined;
      };
      enviar_contrato: {
        Args: { p_numero: string; p_obra_id: number };
        Returns: undefined;
      };
      enviar_cotizacion: {
        Args: { p_precios: Json; p_token: string };
        Returns: undefined;
      };
      enviar_op_a_tesoreria: { Args: { p_id: number }; Returns: undefined };
      enviar_si_lista: {
        Args: { p_numero: string; p_obra_id: number };
        Returns: boolean;
      };
      enviar_sugerencia: {
        Args: {
          p_capturas: string[];
          p_pantalla: string;
          p_ruta: string;
          p_texto: string;
          p_tipo: string;
        };
        Returns: number;
      };
      es_residente: { Args: Record<PropertyKey, never>; Returns: boolean };
      exigir_rol: { Args: { p_roles: string[] }; Returns: undefined };
      faltante: {
        Args: {
          p: Omit<
            Database["public"]["Tables"]["partidas"]["Row"],
            Database["public"]["Tables"]["partidas"]["ComputedFields"]
          >;
        };
        Returns: number;
      };
      fijar_contrasena: {
        Args: { p_clave: string; p_conservar?: string; p_user: string };
        Returns: undefined;
      };
      fn_comprometido_ordenes_mo: {
        Args: { p_partida_id: number };
        Returns: number;
      };
      fn_comprometido_partida: {
        Args: { p_partida_id: number };
        Returns: number;
      };
      fn_cotizacion_limite: { Args: { p_token: string }; Returns: undefined };
      fn_detraccion_sugerida: {
        Args: { p_comprobante_id: number };
        Returns: number;
      };
      fn_exigir_neto: {
        Args: { p_item_ids: number[]; p_total: number };
        Returns: undefined;
      };
      fn_faltante_partida: { Args: { p_partida_id: number }; Returns: number };
      fn_garantia_historica: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      fn_orden_etapa: {
        Args: { p_etapa: string; p_obra_id: number };
        Returns: number;
      };
      fn_os_comprobante: {
        Args: {
          p_numero: string;
          p_obra_id: number;
          p_tipo: Database["public"]["Enums"]["tipo_comprobante"];
        };
        Returns: undefined;
      };
      fn_presupuesto_efectivo: {
        Args: { p_partida_id: number };
        Returns: number;
      };
      fn_pu_efectivo: {
        Args: {
          p_aprobado: number;
          p_cotizado: number;
          p_pu: number;
          p_tol: number;
        };
        Returns: number;
      };
      fn_pu_max: { Args: { p_pu: number; p_tol: number }; Returns: number };
      fn_requerido_partida: { Args: { p_partida_id: number }; Returns: number };
      fn_retencion: {
        Args: { p_item_id: number; p_obra_id: number };
        Returns: number;
      };
      fn_retencion_4ta: {
        Args: {
          p_fecha: string;
          p_proveedor_id: number;
          p_tipo: Database["public"]["Enums"]["tipo_comprobante"];
          p_total: number;
        };
        Returns: number;
      };
      fn_soles: { Args: { p: number }; Returns: string };
      get_cotizacion: { Args: { p_token: string }; Returns: Json };
      glosa_rhe_defecto: {
        Args: { p_numero: string; p_obra_id: number };
        Returns: string;
      };
      guardar_detraccion_minimo: {
        Args: { p_monto: number };
        Returns: undefined;
      };
      guardar_detracciones: {
        Args: { p_detracciones: Json; p_obra_id: number };
        Returns: number;
      };
      guardar_glosa_rhe: {
        Args: { p_glosa: string; p_numero: string; p_obra_id: number };
        Returns: undefined;
      };
      guardar_obra: {
        Args: {
          p_direccion: string;
          p_empresa_id: number;
          p_id: number;
          p_nombre: string;
        };
        Returns: number;
      };
      guardar_partidas: {
        Args: { p_eliminar: number[]; p_obra_id: number; p_partidas: Json };
        Returns: number;
      };
      guardar_precios: {
        Args: { p_numero: string; p_obra_id: number; p_precios: Json };
        Returns: undefined;
      };
      guardar_retenciones: {
        Args: { p_obra_id: number; p_retenciones: Json };
        Returns: number;
      };
      hash_relleno: { Args: Record<PropertyKey, never>; Returns: string };
      hook_sin_correo: { Args: { event: Json }; Returns: Json };
      ingreso_intentar: {
        Args: {
          p_clave: string;
          p_conocido: string;
          p_detalle?: Json;
          p_email: string;
          p_ip: string;
        };
        Returns: {
          espera: number;
          user_id: string;
        }[];
      };
      link_pagada_at: {
        Args: { p_numero: string; p_obra: number };
        Returns: string;
      };
      link_vigente: {
        Args: { p_token: string };
        Returns: {
          comprobante_tipo:
            | Database["public"]["Enums"]["tipo_comprobante"]
            | null;
          contrato_enviado_at: string | null;
          cotizacion_enviada_at: string | null;
          cotizacion_estado: Database["public"]["Enums"]["cotizacion_estado"];
          cotizacion_recibida_at: string | null;
          created_at: string;
          created_by: string | null;
          entrega_cerrada_at: string | null;
          entrega_cerrada_by: string | null;
          entrega_cerrada_motivo: string | null;
          es_retencion: boolean;
          estado: Database["public"]["Enums"]["estado_oc"];
          fecha: string;
          fecha_inicio: string | null;
          glosa_rhe: string | null;
          historico: boolean;
          motivo_anulacion: string | null;
          numero: string;
          obra_id: number;
          proveedor_id: number;
          requiere_guia: boolean;
          retenida_en: string | null;
          tipo: Database["public"]["Enums"]["tipo_orden"];
          token_cotizacion: string | null;
          updated_at: string;
          updated_by: string | null;
          valorizacion_id: number | null;
        };
        SetofOptions: {
          from: "*";
          to: "ordenes_compra";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      marcar_cotizacion_enviada: {
        Args: { p_numero: string; p_obra_id: number };
        Returns: undefined;
      };
      marcar_guia_anulada: { Args: { p_id: number }; Returns: undefined };
      mi_rol: { Args: Record<PropertyKey, never>; Returns: string };
      mo_partidas: {
        Args: { p_obra_id: number };
        Returns: {
          descripcion: string;
          ejecutado_sin_valorizar: number;
          en_logistica: number;
          en_tesoreria: number;
          etapa: string;
          orden_etapa: number;
          pagado_neto: number;
          partida_id: number;
          por_recibir: number;
          presupuesto_efectivo: number;
          pu: number;
          recibido: number;
          retencion_acumulada: number;
          unidad: string;
          valorizado_pagado: number;
          valorizado_sin_pagar: number;
        }[];
      };
      notificar: {
        Args: {
          p_cuerpo: string;
          p_href: string;
          p_rol: string;
          p_tipo: string;
          p_titulo: string;
        };
        Returns: undefined;
      };
      notificar_usuario: {
        Args: {
          p_cuerpo: string;
          p_href: string;
          p_tipo: string;
          p_titulo: string;
          p_user: string;
        };
        Returns: undefined;
      };
      obras_residente: { Args: Record<PropertyKey, never>; Returns: number[] };
      observar_avance: {
        Args: { p_id: number; p_texto: string };
        Returns: undefined;
      };
      orden_visible_residente: {
        Args: { p_numero: string; p_obra: number };
        Returns: boolean;
      };
      ordenar_etapas_obra: {
        Args: { p_etapas: string[]; p_obra_id: number };
        Returns: undefined;
      };
      pagar_documento: {
        Args: {
          p_banco: string;
          p_fecha: string;
          p_monto: number;
          p_numero: string;
          p_numero_operacion: string;
          p_obra_id: number;
          p_orden_pago_id: number;
          p_voucher_nombre: string;
          p_voucher_path: string;
        };
        Returns: number;
      };
      publicar_presupuesto: { Args: { p_obra_id: number }; Returns: undefined };
      rechazar_documento: {
        Args: {
          p_correccion?: string;
          p_factura_nueva?: boolean;
          p_motivo: string;
          p_numero: string;
          p_obra_id: number;
          p_orden_pago_id: number;
        };
        Returns: undefined;
      };
      reemplazar_residente: {
        Args: { p_entra: number; p_obra_id: number; p_sale: number };
        Returns: undefined;
      };
      reenviar_a_tesoreria: {
        Args: { p_nota: string; p_numero: string; p_obra_id: number };
        Returns: undefined;
      };
      reenviar_cotizacion: {
        Args: { p_numero: string; p_obra_id: number };
        Returns: string;
      };
      registrar_avance: {
        Args: {
          p_cantidad: number;
          p_capturado?: string;
          p_fecha: string;
          p_fotos: string[];
          p_lat?: number;
          p_lng?: number;
          p_observacion?: string;
          p_partida_id: number;
          p_precision?: number;
          p_reemplaza_id?: number;
        };
        Returns: number;
      };
      registrar_comprobante: {
        Args: {
          p_archivo_path: string;
          p_detraccion?: number;
          p_fecha: string;
          p_item_ids: number[];
          p_numero: string;
          p_proveedor_id: number;
          p_retencion: number;
          p_serie: string;
          p_tipo: Database["public"]["Enums"]["tipo_comprobante"];
          p_total: number;
        };
        Returns: number;
      };
      registrar_entrega: {
        Args: {
          p_cantidad: number;
          p_capturado?: string;
          p_fotos: string[];
          p_lat?: number;
          p_lng?: number;
          p_observacion?: string;
          p_oc_item_id: number;
          p_precision?: number;
        };
        Returns: number;
      };
      registrar_guia: {
        Args: {
          p_archivo_path: string;
          p_datos: Json;
          p_numero: string;
          p_numero_guia: string;
          p_obra_id: number;
        };
        Returns: number;
      };
      registrar_pago: {
        Args: {
          p_aplicaciones: Json;
          p_banco: string;
          p_empresa_id: number;
          p_fecha: string;
          p_numero_operacion: string;
        };
        Returns: number;
      };
      resolver_solicitud: {
        Args: { p_aprobar: boolean; p_id: number; p_respuesta: string };
        Returns: undefined;
      };
      revisar_solicitud: {
        Args: { p_aprobar: boolean; p_comentario: string; p_id: number };
        Returns: undefined;
      };
      rol_actual: { Args: Record<PropertyKey, never>; Returns: string };
      rol_en: { Args: { p_roles: string[] }; Returns: boolean };
      rol_prod1: { Args: { p_rol: string }; Returns: boolean };
      ruta_obra_residente: { Args: { p_name: string }; Returns: boolean };
      sesion_bloqueada: { Args: Record<PropertyKey, never>; Returns: boolean };
      set_datos_os: {
        Args: {
          p_comprobante: Database["public"]["Enums"]["tipo_comprobante"];
          p_fecha_inicio: string;
          p_numero: string;
          p_obra_id: number;
        };
        Returns: undefined;
      };
      set_requiere_guia: {
        Args: { p_numero: string; p_obra_id: number; p_requiere: boolean };
        Returns: undefined;
      };
      siguiente_numero_oc: { Args: { p_obra_id: number }; Returns: string };
      solicitar_adicional: {
        Args: { p_datos: Json; p_motivo: string; p_obra_id: number };
        Returns: number;
      };
      solicitar_baja_partida: {
        Args: { p_cantidad?: number; p_motivo: string; p_partida_id: number };
        Returns: number;
      };
      solicitar_guia: {
        Args: { p_datos: Json; p_numero: string; p_obra_id: number };
        Returns: number;
      };
      solicitar_persona: {
        Args: {
          p_datos: Json;
          p_motivo: string;
          p_persona_id: number;
          p_tipo: string;
        };
        Returns: number;
      };
      token_cotizacion_de: {
        Args: { p_numero: string; p_obra: number };
        Returns: string;
      };
      valorizar: { Args: { p_obra_id: number }; Returns: number };
    };
    Enums: {
      cotizacion_estado: "SIN_ENVIAR" | "ENVIADA" | "RECIBIDA";
      estado_oc:
        | "BORRADOR"
        | "EMITIDA"
        | "PRECIOS_CONFIRMADOS"
        | "FACTURADA"
        | "EN_TESORERIA"
        | "PAGADA"
        | "EN_ENTREGA"
        | "RECIBIDA"
        | "ANULADA";
      rol:
        | "LOGISTICA"
        | "CONTABILIDAD"
        | "TESORERIA"
        | "ADMIN"
        | "RESIDENTE"
        | "GERENCIA"
        | "OPERACIONES"
        | "OBRAS"
        | "RRHH"
        | "JEFE_OPERACIONES";
      rubro:
        | "MATERIAL"
        | "MANO OBRA"
        | "SUBCONTRATO"
        | "LOCACION"
        | "PROYECTO"
        | "FINALIZACION"
        | "OTRO";
      tipo_adjunto: "GUIA" | "VOUCHER" | "FOTO" | "CONTRATO";
      tipo_comprobante: "FACTURA" | "RXH" | "BOLETA" | "RECIBO_SIMPLE" | "OTRO";
      tipo_orden: "OC" | "OS";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      cotizacion_estado: ["SIN_ENVIAR", "ENVIADA", "RECIBIDA"],
      estado_oc: [
        "BORRADOR",
        "EMITIDA",
        "PRECIOS_CONFIRMADOS",
        "FACTURADA",
        "EN_TESORERIA",
        "PAGADA",
        "EN_ENTREGA",
        "RECIBIDA",
        "ANULADA",
      ],
      rol: [
        "LOGISTICA",
        "CONTABILIDAD",
        "TESORERIA",
        "ADMIN",
        "RESIDENTE",
        "GERENCIA",
        "OPERACIONES",
        "OBRAS",
        "RRHH",
        "JEFE_OPERACIONES",
      ],
      rubro: [
        "MATERIAL",
        "MANO OBRA",
        "SUBCONTRATO",
        "LOCACION",
        "PROYECTO",
        "FINALIZACION",
        "OTRO",
      ],
      tipo_adjunto: ["GUIA", "VOUCHER", "FOTO", "CONTRATO"],
      tipo_comprobante: ["FACTURA", "RXH", "BOLETA", "RECIBO_SIMPLE", "OTRO"],
      tipo_orden: ["OC", "OS"],
    },
  },
} as const;
