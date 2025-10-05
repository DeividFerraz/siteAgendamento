using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace siteAgendamento.Migrations
{
    /// <inheritdoc />
    public partial class initiDois : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Settings_BusinessDays",
                table: "Tenants",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Settings_CloseTime",
                table: "Tenants",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "Settings_DefaultAppointmentMinutes",
                table: "Tenants",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Settings_OpenTime",
                table: "Tenants",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Settings_Timezone",
                table: "Tenants",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Settings_BusinessDays",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "Settings_CloseTime",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "Settings_DefaultAppointmentMinutes",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "Settings_OpenTime",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "Settings_Timezone",
                table: "Tenants");
        }
    }
}
